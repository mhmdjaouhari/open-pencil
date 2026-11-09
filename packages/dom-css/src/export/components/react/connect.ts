import { es, jsx } from '@open-pencil/emit'

import { holeOf, indentElement, type ConnectedComponent } from '../connect'
import type { ComponentNode } from '../model'
import { classValue, drawing, type MarkupUses } from './shared'

/** Writes a node of a component's tree as JSX at a nesting depth. */
type Markup = (node: ComponentNode, uses: MarkupUses, depth: number) => es.SyntaxNode

/** A slot's hole replaced by its content's markup. */
function filledSlots(
  node: es.SyntaxNode,
  slots: ReadonlyMap<string, es.SyntaxNode[]>
): es.SyntaxNode {
  if (node.type !== 'JSXElement') return node
  return {
    ...node,
    children: es.children(node, 'children').flatMap((child) => {
      const hole = holeOf(child)
      if (hole === undefined) return [filledSlots(child, slots)]
      return slots.get(hole) ?? []
    })
  }
}

function withAttribute(node: es.SyntaxNode, attribute: es.SyntaxNode): es.SyntaxNode {
  const opening = es.child(node, 'openingElement')
  if (!opening) return node
  return {
    ...node,
    openingElement: { ...opening, attributes: [...es.children(opening, 'attributes'), attribute] }
  }
}

/**
 * The code component a connected instance stands for, with its slots' content written as any
 * other markup, and the parent's placement as its `className`. Its imports are recorded.
 */
export function connectedElement(
  node: ConnectedComponent,
  uses: MarkupUses,
  depth: number,
  markup: Markup
): es.SyntaxNode {
  for (const { module, names } of node.imports) {
    const imported = uses.connected.get(module) ?? new Set()
    for (const name of names) imported.add(name)
    uses.connected.set(module, imported)
  }
  const slots = new Map(
    node.slots.map(({ hole, children }) => [
      hole,
      children.map((child) => markup(child, uses, depth + 1))
    ])
  )
  const filled = indentElement(filledSlots(node.element, slots), depth)
  const placement = uses.classOf(node.className)
  const placed =
    placement.type === 'Literal' && !placement.value
      ? filled
      : withAttribute(filled, jsx.attribute('className', classValue(placement)))
  return drawing(placed, node.layerId, uses)
}

/** `import { … } from '…'` for each module connected instances use, in a stable order. */
export function connectedImports(uses: MarkupUses): es.SyntaxNode[] {
  return [...uses.connected]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => es.namedImport(module, [...names].sort()))
}
