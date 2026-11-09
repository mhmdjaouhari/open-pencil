import { copyFills, copyStrokes } from '../copy'
import type { SceneGraph } from '../graph'
import { hasInstanceOverride } from '../instances/overrides'
import type { Color } from '../primitives'
import type { Fill, SceneNode, Stroke } from '../types'
import {
  gradientStopBindingTarget,
  paintBindingTarget,
  paintColorBindingOwner,
  type PaintBindingList
} from './fields'
import { collectionsResolving, getNodeVariableModeId } from './resolution'
import { subtreeNodes } from './subtree'

/**
 * Figma keeps a bound paint's color and opacity as a cache of its variable: it draws and reads
 * what the paint holds, and writes the variable's color into it again only once the color the
 * variable gives that layer changes, so an edit to the paint sticks until then. The color each
 * binding last gave its paint lives here, beside the graph and never saved, by layer and binding
 * field. A layer without an entry, such as one just loaded, pasted, or restored, counts its
 * paint's own color as the last one applied.
 */
interface AppliedColor {
  readonly variableId: string
  readonly color: Color
}

const appliedColors = new WeakMap<SceneNode, Map<string, AppliedColor>>()

const PAINT_LISTS = ['fills', 'strokes'] as const

/**
 * A binding of a paint's color, or of one gradient stop's color when `stop` is set. A paint's
 * color carries the variable's alpha as the paint's opacity; a stop's color carries its own alpha
 * and leaves the paint's opacity alone.
 */
interface BoundPaint {
  readonly field: string
  readonly list: PaintBindingList
  readonly index: number
  readonly stop: number | null
  readonly variableId: string
}

/** The paint, or gradient stop of a paint, a binding field colors, or null for any other field. */
function boundPaintTarget(
  field: string
): { list: PaintBindingList; index: number; stop: number | null } | null {
  const stop = gradientStopBindingTarget(field)
  if (stop) return stop
  const paint = paintBindingTarget(field)
  return paint ? { ...paint, stop: null } : null
}

/** Whether `paint` has what `bound` colors: the paint itself, or its gradient stop. */
function hasTarget(paint: Fill | undefined, bound: { stop: number | null }): paint is Fill {
  if (!paint) return false
  return bound.stop === null || paint.gradientStops?.at(bound.stop) !== undefined
}

/**
 * The paints and gradient stops of `node` whose color is bound to a variable, each with a paint
 * or stop there to color.
 */
function boundPaints(node: SceneNode): BoundPaint[] {
  const paints: BoundPaint[] = []
  for (const [field, variableId] of Object.entries(node.boundVariables)) {
    const target = boundPaintTarget(field)
    if (target && hasTarget(node[target.list].at(target.index), target))
      paints.push({ field, ...target, variableId })
  }
  return paints
}

/** Whether a layer has a paint, or a gradient stop, whose color is bound to a variable. */
export function hasBoundPaints(node: SceneNode): boolean {
  for (const field in node.boundVariables) if (paintColorBindingOwner(field)) return true
  return false
}

/** A paint's color with its opacity as alpha, as a variable's color carries it. */
function paintColor(paint: Fill): Color {
  return { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: paint.opacity }
}

/** Saved colors are single precision, so a color read back from a file still matches its source. */
const COLOR_TOLERANCE = 1e-6

function sameColor(a: Color, b: Color): boolean {
  return (
    Math.abs(a.r - b.r) <= COLOR_TOLERANCE &&
    Math.abs(a.g - b.g) <= COLOR_TOLERANCE &&
    Math.abs(a.b - b.b) <= COLOR_TOLERANCE &&
    Math.abs(a.a - b.a) <= COLOR_TOLERANCE
  )
}

/** The color a binding's target shows: a paint's color with its opacity, or a stop's color. */
function targetColor(bound: { stop: number | null }, paint: Fill): Color {
  const stop = bound.stop === null ? undefined : paint.gradientStops?.at(bound.stop)
  return stop ? { ...stop.color } : paintColor(paint)
}

function lastApplied(node: SceneNode, bound: BoundPaint, paint: Fill): Color {
  const entry = appliedColors.get(node)?.get(bound.field)
  return entry?.variableId === bound.variableId ? entry.color : targetColor(bound, paint)
}

/**
 * A layer copied from another keeps the colors its bindings last applied there, so the copy's
 * paints, edits included, stay as they are until their variables' colors for it change.
 */
export function copyAppliedBoundPaints(source: SceneNode, copy: SceneNode): void {
  const entries = appliedColors.get(source)
  if (entries) appliedColors.set(copy, new Map(entries))
}

function recordApplied(node: SceneNode, bound: BoundPaint, color: Color): void {
  let entries = appliedColors.get(node)
  if (!entries) {
    entries = new Map()
    appliedColors.set(node, entries)
  }
  entries.set(bound.field, { variableId: bound.variableId, color: { ...color } })
}

/**
 * Writes the variable's color into what the binding colors: into a paint, its RGB at full alpha
 * and its alpha as the paint's opacity; into a gradient stop, the color with its alpha as the
 * stop's own. `paint` is a copy this may write into.
 */
function applyColor(paint: Fill, bound: { stop: number | null }, color: Color): void {
  if (bound.stop === null) {
    paint.color = { ...color, a: 1 }
    paint.opacity = color.a
    return
  }
  const stop = paint.gradientStops?.at(bound.stop)
  if (stop) stop.color = { ...color }
}

/** Whether `paint` already shows `color` as a bound paint, or bound stop, stores it. */
function showsColor(paint: Fill, bound: BoundPaint, color: Color): boolean {
  if (bound.stop !== null) return sameColor(targetColor(bound, paint), color)
  return sameColor(paintColor(paint), color) && paint.color.a === 1
}

/** Copies what a binding colors in `own` into `paint`, the paint a sync writes in its place. */
function keepColor(paint: Fill, own: Fill, bound: { stop: number | null }): void {
  if (bound.stop === null) {
    paint.color = { ...own.color }
    paint.opacity = own.opacity
    return
  }
  const ownStop = own.gradientStops?.at(bound.stop)
  const stop = paint.gradientStops?.at(bound.stop)
  if (ownStop && stop) stop.color = { ...ownStop.color }
}

type PaintLists = Pick<Partial<SceneNode>, 'fills' | 'strokes'>

/**
 * Whether `node` is an instance, or a layer an instance copies from its component, with a paint
 * list neither it nor an instance around it overrides: such paints follow the component, and
 * refreshing them is no edit.
 */
export function copiesComponentPaints(
  graph: SceneGraph,
  node: SceneNode,
  list: PaintBindingList
): boolean {
  const walk = { copied: false }
  const overriding = graph.closest(node.id, (current) => {
    if (current.type !== 'INSTANCE') return false
    walk.copied = true
    return hasInstanceOverride(current.instanceOverrides, current.id, node.id, list)
  })
  return walk.copied && !overriding
}

/**
 * Writes refreshed paints. A copy's paints that follow its component are derived values that a
 * save leaves to the component, not edits written over it.
 */
function writePaints(graph: SceneGraph, node: SceneNode, changes: PaintLists): void {
  const derived = PAINT_LISTS.every(
    (list) => !changes[list] || copiesComponentPaints(graph, node, list)
  )
  const write = () => graph.updateNode(node.id, changes)
  if (derived) graph.applyComponentDerivedDuring(write)
  else write()
}

/**
 * Writes into each bound paint the color its variable gives the layer now, where that differs
 * from the color last applied, or wherever `forced` says, and records what each binding gives.
 */
function refresh(graph: SceneGraph, node: SceneNode, forced: (field: string) => boolean): void {
  let fills: Fill[] | undefined
  let strokes: Stroke[] | undefined
  for (const bound of boundPaints(node)) {
    const color = graph.resolveColorVariableForNode(node.id, bound.variableId)
    const paint = node[bound.list].at(bound.index)
    if (!color || !paint) continue
    const last = lastApplied(node, bound, paint)
    recordApplied(node, bound, color)
    if ((!forced(bound.field) && sameColor(last, color)) || showsColor(paint, bound, color))
      continue
    if (bound.list === 'fills') {
      fills ??= copyFills(node.fills)
      applyColor(fills[bound.index], bound, color)
    } else {
      strokes ??= copyStrokes(node.strokes)
      applyColor(strokes[bound.index], bound, color)
    }
  }
  const changes: PaintLists = {}
  if (fills) changes.fills = fills
  if (strokes) changes.strokes = strokes
  if (fills || strokes) writePaints(graph, node, changes)
}

const NONE_FORCED = (): boolean => false
const ALL_FORCED = (): boolean => true

/**
 * Refreshes a layer's bound paints and gradient stops: each takes its variable's color for the
 * layer, alpha as a paint's opacity or a stop's own alpha, once that color differs from the one last applied, discarding edits made since, as
 * Figma refreshes them when a variable's value or a layer's mode changes.
 */
export function refreshBoundPaints(graph: SceneGraph, node: SceneNode): void {
  if (hasBoundPaints(node)) refresh(graph, node, NONE_FORCED)
}

/**
 * Gives one bound paint, or bound gradient stop, its variable's color for the layer, as binding
 * it does in Figma.
 */
export function applyBoundPaintColor(graph: SceneGraph, node: SceneNode, field: string): void {
  if (paintColorBindingOwner(field)) refresh(graph, node, (bound) => bound === field)
}

/**
 * Gives every bound paint in this subtree its variable's color where it sits. A new instance
 * or a layer an instance sync adds is a copy, which shows its variables in its own context rather
 * than whatever its component's paints hold.
 */
export function applyBoundPaintColorsIn(graph: SceneGraph, rootId: string): void {
  for (const node of subtreeNodes(graph, [rootId]))
    if (hasBoundPaints(node)) refresh(graph, node, ALL_FORCED)
}

/** Refreshes the bound paints in this subtree whose variables now give their layers another color. */
export function refreshBoundPaintsIn(graph: SceneGraph, rootId: string): void {
  for (const node of subtreeNodes(graph, [rootId])) refreshBoundPaints(graph, node)
}

/**
 * Records, for the paint lists a write sets, the colors their variables give the layer now, so a
 * paint written with another color or opacity keeps it until that color changes.
 */
export function recordWrittenBoundPaints(
  graph: SceneGraph,
  node: SceneNode,
  written: PaintLists
): void {
  for (const bound of boundPaints(node)) {
    if (!written[bound.list]) continue
    const color = graph.resolveColorVariableForNode(node.id, bound.variableId)
    if (color) recordApplied(node, bound, color)
  }
}

/**
 * Refreshes the bound paints in a moved layer's subtree that resolve through a collection whose
 * mode the move changed, as Figma does when a layer enters a frame or page in another mode. A
 * move between parents in the same modes, or of layers that bind no paint, costs no more than
 * comparing those modes.
 */
export function refreshMovedBoundPaints(
  graph: SceneGraph,
  nodeId: string,
  previousParentId: string | null | undefined
): void {
  if (graph.isApplyingImportedState || graph.variableCollections.size === 0) return
  const parentId = graph.nodes.get(nodeId)?.parentId
  if (!parentId) return
  const previous = previousParentId && graph.nodes.has(previousParentId) ? previousParentId : null
  const changed = new Set(
    [...graph.variableCollections.keys()].filter(
      (id) =>
        !previous ||
        getNodeVariableModeId(graph, previous, id) !== getNodeVariableModeId(graph, parentId, id)
    )
  )
  if (changed.size === 0) return
  const reaches = new Map<string, boolean>()
  const reachesChanged = (variableId: string) => {
    let found = reaches.get(variableId)
    if (found === undefined) {
      found = [...collectionsResolving(graph, [variableId])].some((id) => changed.has(id))
      reaches.set(variableId, found)
    }
    return found
  }
  for (const node of subtreeNodes(graph, [nodeId])) {
    if (boundPaints(node).some((bound) => reachesChanged(bound.variableId)))
      refresh(graph, node, NONE_FORCED)
  }
}

/** The bindings in `bindings` of the colors of paints, and their gradient stops, in `list`. */
function listBindings(
  bindings: Readonly<Record<string, string>>,
  list: PaintBindingList
): BoundPaint[] {
  const bound: BoundPaint[] = []
  for (const [field, variableId] of Object.entries(bindings)) {
    const target = boundPaintTarget(field)
    if (target?.list === list) bound.push({ field, ...target, variableId })
  }
  return bound
}

function reboundPaint(
  target: SceneNode,
  bindings: Readonly<Record<string, string>>,
  list: PaintBindingList
): boolean {
  return listBindings(bindings, list).some(
    (bound) =>
      hasTarget(target[list].at(bound.index), bound) &&
      bound.variableId !== target.boundVariables[bound.field]
  )
}

/**
 * A copy's bound paints are its own cache, as Figma keeps them per layer, so a component's edit
 * to its paint's color or opacity does not reach them. An instance sync writing a copy's paints
 * keeps the color and opacity of each one still bound to the same variable, and gives it the
 * variable's color for the copy once that differs from the one last applied, or when it binds
 * anew. `updates` holds what the sync writes, whose paints this sets in place.
 */
export function keepCopyBoundPaints(
  graph: SceneGraph,
  target: SceneNode,
  updates: Partial<SceneNode>
): void {
  const bindings = updates.boundVariables ?? target.boundVariables
  for (const list of PAINT_LISTS) {
    // A paint the component binds anew keeps its own paint otherwise, but takes the new color.
    if (!updates[list] && reboundPaint(target, bindings, list))
      Object.assign(updates, {
        [list]: list === 'fills' ? copyFills(target.fills) : copyStrokes(target.strokes)
      })
    const paints = updates[list]
    if (!paints) continue
    for (const bound of listBindings(bindings, list)) {
      const paint = paints.at(bound.index)
      if (!hasTarget(paint, bound)) continue
      const own = target[list].at(bound.index)
      const keeps = hasTarget(own, bound) && target.boundVariables[bound.field] === bound.variableId
      if (keeps) keepColor(paint, own, bound)
      const color = graph.resolveColorVariableForNode(target.id, bound.variableId)
      if (!color) continue
      if (!keeps || !sameColor(lastApplied(target, bound, own), color))
        applyColor(paint, bound, color)
      recordApplied(target, bound, color)
    }
  }
}
