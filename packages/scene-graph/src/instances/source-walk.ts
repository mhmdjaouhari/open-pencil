import type { SceneGraph } from '../graph'
import type { SceneNode } from '../types'
import { copiedComponentLayerId } from './overrides'

/**
 * Walk an instance's layers beside the component layers they copy, matched the way instance
 * sync matches them. `visit` returns whether to continue into that pair's children. With
 * `strict`, two layers claiming one source throw instead of the later one winning.
 */
export function walkInstanceSources(
  graph: SceneGraph,
  instance: SceneNode,
  visit: (source: SceneNode, target: SceneNode) => boolean,
  strict = false
): void {
  if (instance.type !== 'INSTANCE' || !instance.componentId) return
  const component = graph.getNode(instance.componentId)
  if (!component) return
  const walk = (sourceParent: SceneNode, instanceParent: SceneNode): void => {
    const sources = new Set(sourceParent.childIds)
    const bySource = new Map<string, SceneNode>()
    for (const child of graph.getChildren(instanceParent.id)) {
      // Only a copy of one of these component layers pairs. Content an instance owns in a slot,
      // such as several instances of one component, copies none of them.
      const sourceId = copiedComponentLayerId(instance.instanceOverrides, instance.id, child)
      if (!sourceId || !sources.has(sourceId)) continue
      if (strict && bySource.has(sourceId))
        throw new Error(`Ambiguous component-property target ${sourceId}`)
      bySource.set(sourceId, child)
    }
    for (const sourceId of sourceParent.childIds) {
      const source = graph.getNode(sourceId)
      const target = bySource.get(sourceId)
      if (source && target && visit(source, target)) walk(source, target)
    }
  }
  walk(component, instance)
}
