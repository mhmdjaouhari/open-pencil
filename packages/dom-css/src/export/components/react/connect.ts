import { es, jsx } from '@open-pencil/emit'

import { holeOf, indentElement, type ConnectedComponent } from '../connect'
import type { ComponentNode } from '../model'
import { classValue, drawing, type MarkupUses } from './shared'

/** Writes a node of a component's tree as JSX at a nesting depth. */
type Markup = (node: ComponentNode, uses: MarkupUses, depth: number) => es.SyntaxNode

/**
 * A prop a slot fills (`action={$Action}`): its one element, or a fragment of several, and no
 * prop when the slot is empty.
 */
function slotAttribute(
  attribute: es.SyntaxNode,
  slots: ReadonlyMap<string, es.SyntaxNode[]>
): es.SyntaxNode[] {
  const hole = holeOf(attribute.value)
  const content = hole === undefined ? undefined : slots.get(hole)
  if (!content) return [attribute]
  if (content.length === 0) return []
  const value = content.length === 1 ? content[0] : jsx.fragment(content, 0)
  return [{ ...attribute, value: jsx.container(value) }]
}

/** A slot's hole replaced by its content's markup, as a child or as the prop it fills. */
function filledSlots(
  node: es.SyntaxNode,
  slots: ReadonlyMap<string, es.SyntaxNode[]>
): es.SyntaxNode {
  if (node.type !== 'JSXElement') return node
  const opening = es.child(node, 'openingElement')
  return {
    ...node,
    openingElement: opening && {
      ...opening,
      attributes: es
        .children(opening, 'attributes')
        .flatMap((attribute) => slotAttribute(attribute, slots))
    },
    children: es.children(node, 'children').flatMap((child) => {
      const hole = holeOf(child)
      if (hole === undefined) return [filledSlots(child, slots)]
      return slots.get(hole) ?? []
    })
  }
}

const JOINED_CLASSES = es.parseExpression("[$own, $placed].join(' ')")

/** The template's own `className` value as an expression: a string, or what its braces hold. */
function classExpression(value: es.SyntaxNode | undefined): es.SyntaxNode | undefined {
  if (value?.type === 'Literal') return value
  return value?.type === 'JSXExpressionContainer' ? es.child(value, 'expression') : undefined
}

/** Two class values as one: a string when both are, an expression joining them otherwise. */
function joinedClasses(own: es.SyntaxNode, placed: es.SyntaxNode): es.SyntaxNode {
  if (own.type === 'Literal' && placed.type === 'Literal')
    return es.string(`${String(own.value)} ${String(placed.value)}`)
  return es.fill(JOINED_CLASSES, { $own: own, $placed: placed })
}

/**
 * The parent's placement as the element's `className`, joined to the class the template
 * already gives it (a placeholder's size), since an element takes one `className`.
 */
function withPlacement(node: es.SyntaxNode, placed: es.SyntaxNode): es.SyntaxNode {
  const opening = es.child(node, 'openingElement')
  if (!opening) return node
  const attributes = es.children(opening, 'attributes')
  const isClassName = (attribute: es.SyntaxNode) =>
    es.child(attribute, 'name')?.name === 'className'
  const own = classExpression(es.child(attributes.find(isClassName), 'value'))
  const value = own ? joinedClasses(own, placed) : placed
  return {
    ...node,
    openingElement: {
      ...opening,
      attributes: [
        ...attributes.filter((attribute) => !isClassName(attribute)),
        jsx.attribute('className', classValue(value))
      ]
    }
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
    placement.type === 'Literal' && !placement.value ? filled : withPlacement(filled, placement)
  return drawing(placed, node.layerId, uses)
}

/** `import { … } from '…'` for each module connected instances use, in a stable order. */
export function connectedImports(uses: MarkupUses): es.SyntaxNode[] {
  return [...uses.connected]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => es.namedImport(module, [...names].sort()))
}
