import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { instanceMainComponent } from '@open-pencil/scene-graph/instances'

import { connectedLayer, type ConnectedComponent } from './connect'
import { drawsAsMain } from './drawn'
import type { ComponentElement, ComponentNode } from './model'
import { shownText } from './references'

/** The elements of a component tree, depth first. */
function* elements(node: ComponentNode): Generator<ComponentElement> {
  if (node.type !== 'element') return
  yield node
  for (const child of node.children) yield* elements(child)
}

/**
 * A selected layer as the code component it stands for, as Code Connect shows an instance: an
 * instance that draws as its main component, which stores one, with the template filled from
 * its properties and each slot's content taken from the layer's own tree.
 */
export function connectedSelection(
  graph: SceneGraph,
  layer: SceneNode,
  tree: ComponentElement
): ConnectedComponent | null {
  if (layer.type !== 'INSTANCE') return null
  const main = instanceMainComponent(graph, layer)
  if (!main || !drawsAsMain(graph, layer, main)) return null
  const connected = connectedLayer(graph, layer, '', (id) => shownText(graph, layer, id))
  if (!connected) return null
  const { slotPaths, imports, element } = connected
  const drawn = [...elements(tree)]
  return {
    type: 'connected',
    imports,
    element,
    // Nothing places the selection, so it keeps no class of its own.
    className: '',
    layerId: layer.id,
    slots: slotPaths.map(({ hole, frameId }) => ({
      hole,
      children: drawn.find((found) => found.layerId === frameId)?.children ?? []
    }))
  }
}
