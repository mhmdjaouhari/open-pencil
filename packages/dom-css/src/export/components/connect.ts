import { es, jsx } from '@open-pencil/emit'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { behaviourOwner, layerPath } from '@open-pencil/scene-graph/behaviours'
import type { CodeConnect } from '@open-pencil/scene-graph/code-connect'
import { instanceMainComponent } from '@open-pencil/scene-graph/instances'
import { layoutSizing, type LayoutSizingAxis } from '@open-pencil/scene-graph/layout'
import { OPEN_PENCIL_PLUGIN_DATA, readPluginData } from '@open-pencil/scene-graph/plugin-data'
import { instanceSlotFrames, slotPropertyId } from '@open-pencil/scene-graph/slots'

import type { ComponentNode } from './model'

/** A slot of a connected instance: its hole, and the path of its frame below the used layer. */
export interface ConnectedSlotPath {
  hole: string
  path: string
}

/**
 * An instance of a component that stands for a code component, written as the template its
 * main component stores, with its variant, text, and boolean holes filled.
 */
export interface ConnectedLayer {
  type: 'connected'
  layerId?: string
  imports: CodeConnect['imports']
  /** The filled template; slot holes stay as `{$name}` for the generator to fill. */
  element: es.SyntaxNode
  slotPaths: ConnectedSlotPath[]
  /** Axes the code component sizes itself on, where the parent's placement sets no size. */
  ownSize: { width: boolean; height: boolean }
}

/**
 * Whether the instance takes its size on `axis` from its component: it hugs its content, or
 * keeps the size the component draws. A size set any other way is the parent's to place.
 */
function ownsSize(
  graph: SceneGraph,
  instance: SceneNode,
  main: SceneNode,
  axis: LayoutSizingAxis
): boolean {
  const sizing = layoutSizing(graph, instance, axis)
  if (sizing === 'HUG') return true
  const field = axis === 'HORIZONTAL' ? 'width' : 'height'
  return sizing === 'FIXED' && Math.abs(instance[field] - main[field]) < 0.5
}

/** A connected layer in a component's tree, with each slot's content built. */
export interface ConnectedComponent extends Omit<ConnectedLayer, 'slotPaths' | 'ownSize'> {
  className: string
  slots: { hole: string; children: ComponentNode[] }[]
}

/** A property's hole name: its name with only word characters, as `$Card_title` for `Card title`. */
const holeName = (name: string) => name.replace(/\W+/g, '_').replace(/^_|_$/g, '')

/** The `$name` a JSX expression container holds, if it is a hole. */
export function holeOf(node: unknown): string | undefined {
  if (!es.isNode(node) || node.type !== 'JSXExpressionContainer') return undefined
  const expression = es.child(node, 'expression')
  const name = expression?.type === 'Identifier' ? expression.name : undefined
  return typeof name === 'string' && name.startsWith('$') ? name.slice(1) : undefined
}

/** The code component the instance's main component or its set stands for. */
function codeConnectOf(graph: SceneGraph, main: SceneNode): CodeConnect | undefined {
  const owner = behaviourOwner(graph, main) ?? main
  return readPluginData(owner.pluginData, OPEN_PENCIL_PLUGIN_DATA.codeConnect)
}

type HoleValue = string | boolean

/** What the instance shows for each of its owner's properties, by hole name. */
function holeValues(
  graph: SceneGraph,
  instance: SceneNode,
  main: SceneNode,
  shownText: (propertyId: string) => string | undefined
): Map<string, HoleValue> {
  const owner = behaviourOwner(graph, main) ?? main
  const values = new Map<string, HoleValue>()
  for (const [axis, value] of Object.entries(main.componentPropertyValues))
    values.set(holeName(axis), value)
  for (const definition of owner.componentPropertyDefinitions) {
    if (definition.type === 'TEXT') {
      const text = shownText(definition.id)
      if (text !== undefined) values.set(holeName(definition.name), text)
    } else if (definition.type === 'BOOLEAN') {
      const assignments = instance.componentPropertyAssignments
      const value = Object.hasOwn(assignments, definition.id)
        ? assignments[definition.id]
        : definition.defaultValue
      values.set(holeName(definition.name), value === 'true')
    }
  }
  return values
}

/** An attribute set by a hole: left out for its default or `false`, bare for `true`. */
function filledAttribute(
  attribute: es.SyntaxNode,
  values: ReadonlyMap<string, HoleValue>,
  defaults: CodeConnect['defaults']
): es.SyntaxNode[] {
  const hole = holeOf(attribute.value)
  if (!hole) return [attribute]
  const value = values.get(hole)
  if (value === undefined || value === false || value === defaults[hole]) return []
  const name = es.child(attribute, 'name')?.name
  if (typeof name !== 'string') return []
  return [jsx.attribute(name, value === true ? null : jsx.stringValue(value))]
}

/** A child set by a hole: the words it shows, nothing for an unset one; slots stay holes. */
function filledChild(
  node: es.SyntaxNode,
  values: ReadonlyMap<string, HoleValue>,
  slots: ReadonlySet<string>
): es.SyntaxNode[] {
  const hole = holeOf(node)
  if (!hole || slots.has(hole)) return [fillHoles(node, values, slots, {})]
  const value = values.get(hole)
  return typeof value === 'string' && value.length > 0 ? [jsx.text(value)] : []
}

function fillHoles(
  node: es.SyntaxNode,
  values: ReadonlyMap<string, HoleValue>,
  slots: ReadonlySet<string>,
  defaults: CodeConnect['defaults']
): es.SyntaxNode {
  if (node.type !== 'JSXElement') return node
  const opening = es.child(node, 'openingElement')
  return {
    ...node,
    openingElement: opening && {
      ...opening,
      attributes: es
        .children(opening, 'attributes')
        .flatMap((attribute) => filledAttribute(attribute, values, defaults))
    },
    children: es.children(node, 'children').flatMap((child) => filledChild(child, values, slots))
  }
}

const isBlank = (node: es.SyntaxNode) =>
  node.type === 'JSXText' && typeof node.value === 'string' && node.value.trim() === ''

/**
 * A filled template laid out as generated markup is: an element holding other elements puts
 * each child on its own line at `depth`, and one holding only words keeps them inline.
 */
export function indentElement(node: es.SyntaxNode, depth: number): es.SyntaxNode {
  if (node.type !== 'JSXElement') return node
  const kids = es.children(node, 'children').filter((child) => !isBlank(child))
  const nested = kids.some((child) => child.type === 'JSXElement')
  const laidOut = kids.map((child) => indentElement(child, depth + 1))
  const line = (level: number) => jsx.whitespace(`\n${'  '.repeat(level)}`)
  return {
    ...node,
    children: nested
      ? [...laidOut.flatMap((child) => [line(depth + 1), child]), line(depth)]
      : laidOut
  }
}

/**
 * The instance as its code component, when its main component or set stores one: the template
 * filled from the instance's properties, and where its slots' content is.
 */
export function connectedLayer(
  graph: SceneGraph,
  instance: SceneNode,
  path: string,
  shownText: (propertyId: string) => string | undefined
): Omit<ConnectedLayer, 'layerId'> | null {
  const main = instanceMainComponent(graph, instance)
  const connect = main && codeConnectOf(graph, main)
  if (!main || !connect) return null
  let template: es.SyntaxNode
  try {
    template = jsx.parseElement(connect.template)
  } catch {
    // A template that does not parse leaves the instance drawn as its layers.
    return null
  }
  const owner = behaviourOwner(graph, main) ?? main
  const slotName = (propertyId: string) =>
    owner.componentPropertyDefinitions.find((definition) => definition.id === propertyId)?.name
  const slotPaths = instanceSlotFrames(graph, instance).flatMap((frame) => {
    const name = slotName(slotPropertyId(frame) ?? '')
    return name
      ? [{ hole: holeName(name), path: `${path}/${layerPath(graph, instance.id, frame.id)}` }]
      : []
  })
  const values = holeValues(graph, instance, main, shownText)
  const slots = new Set(slotPaths.map((slot) => slot.hole))
  return {
    type: 'connected',
    imports: connect.imports,
    element: fillHoles(template, values, slots, connect.defaults),
    slotPaths,
    ownSize: {
      width: ownsSize(graph, instance, main, 'HORIZONTAL'),
      height: ownsSize(graph, instance, main, 'VERTICAL')
    }
  }
}
