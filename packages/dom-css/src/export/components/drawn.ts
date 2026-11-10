import { isEqual } from 'es-toolkit/predicate'

import type {
  ComponentPropertyReferenceField,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'
import { scaleNodeChanges } from '@open-pencil/scene-graph/scaling'

/** What a layer draws, which an instance can change without a property. */
const DRAWN = [
  'fills',
  'strokes',
  'effects',
  'opacity',
  'cornerRadius'
] as const satisfies readonly (keyof SceneNode)[]

/**
 * What a text layer draws besides. Only text draws its font: a `.fig` keeps no font on other
 * layers, so after a round trip theirs no longer follows a scaled instance's.
 */
const TEXT_DRAWN = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'italic'
] as const satisfies readonly (keyof SceneNode)[]

/** How a layer lays out what it holds, which an instance can change without a property. */
const LAYOUT = [
  'layoutMode',
  'itemSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'primaryAxisAlign',
  'counterAxisAlign'
] as const satisfies readonly (keyof SceneNode)[]

/**
 * Values equal but for float rounding: a bound paint's colour is its variable's, which a copy
 * refreshes in double precision while a saved component keeps single (`COLOR_TOLERANCE` in
 * `@open-pencil/scene-graph/variables/paints`), so a mode switch there and back changes no look.
 */
function nearlyEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-5
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((value, index) => nearlyEqual(value, b[index]))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => nearlyEqual(Reflect.get(a, key), Reflect.get(b, key)))
    )
  }
  return isEqual(a, b)
}

const same = (a: SceneNode, b: SceneNode, fields: readonly (keyof SceneNode)[]) =>
  fields.every((field) => nearlyEqual(a[field], b[field]))

const bound = (node: SceneNode, field: ComponentPropertyReferenceField) =>
  node.componentPropertyReferences.some((reference) => reference.field === field)

function childrenMatch(
  graph: SceneGraph,
  drawn: SceneNode,
  main: SceneNode,
  scale: number
): boolean {
  const children = graph.getChildren(drawn.id)
  const mains = graph.getChildren(main.id)
  return (
    children.length === mains.length &&
    children.every((child, index) => {
      const counterpart = mains.at(index)
      return counterpart !== undefined && layerMatches(graph, child, counterpart, scale)
    })
  )
}

/** A main component's layer as an instance scaled by `scale` (`rescale`) draws it. */
function scaled(main: SceneNode, scale: number): SceneNode {
  return scale === 1 ? main : { ...main, ...scaleNodeChanges(main, scale, false) }
}

/**
 * Whether a layer of an instance draws as its main component's does, apart from what a
 * property of the component sets: the text a text property shows and what a boolean property
 * shows or hides, which the component's props pass on.
 */
function layerMatches(
  graph: SceneGraph,
  drawn: SceneNode,
  source: SceneNode,
  scale: number
): boolean {
  const main = scaled(source, scale)
  if (drawn.type !== main.type) return false
  // A slot hidden is its prop left out, which the component draws as it draws an empty slot.
  if (!bound(main, 'VISIBLE') && !bound(main, 'SLOT_CONTENT') && drawn.visible !== main.visible)
    return false
  if (drawn.type === 'TEXT' && !bound(main, 'TEXT') && drawn.text !== main.text) return false
  if (drawn.type === 'INSTANCE' && drawn.componentId !== main.componentId) return false
  if (!same(drawn, main, DRAWN) || !same(drawn, main, LAYOUT)) return false
  if (drawn.type === 'TEXT' && !same(drawn, main, TEXT_DRAWN)) return false
  // A slot's content is the instance's own, which the component's slot prop passes on.
  return bound(main, 'SLOT_CONTENT') || childrenMatch(graph, drawn, source, scale)
}

/**
 * Whether an instance draws exactly as the variant it shows, so a generated component given
 * its property values draws it: the same look, layout, words, and nested components, apart
 * from where its parent places and sizes it, and the scale it was drawn at (`rescale`, which
 * records it on the instance's layers as `componentScale`). An instance with any other change,
 * such as edited text no property sets or a fill of its own, draws its own layers instead.
 */
export function drawsAsMain(graph: SceneGraph, instance: SceneNode, main: SceneNode): boolean {
  const first = graph.getChildren(instance.id).at(0)
  const mainFirst = graph.getChildren(main.id).at(0)
  const scale = first && mainFirst ? first.componentScale / mainFirst.componentScale : 1
  const drawn = scaled(main, scale)
  return (
    same(instance, drawn, DRAWN) &&
    same(instance, drawn, LAYOUT) &&
    childrenMatch(graph, instance, main, scale)
  )
}
