import { es, jsx } from '@open-pencil/emit'

import type { ComponentModel, GeneratedKind } from '../model'

/** `styles.thumb`, or `styles['switch-thumb']` for a class that isn't an identifier. */
export function moduleClass(className: string): es.SyntaxNode {
  return {
    type: 'MemberExpression',
    object: es.identifier('styles'),
    property: es.isIdentifierName(className) ? es.identifier(className) : es.string(className),
    computed: !es.isIdentifierName(className),
    optional: false
  }
}

/** What a component's markup uses, which its module imports. */
export interface MarkupUses {
  component: ComponentModel
  kind: GeneratedKind
  choice: ComponentModel['choice']
  /** Other generated components. */
  components: Set<string>
  /** Code components connected instances stand for: names to import, by module. */
  connected: Map<string, Set<string>>
  icons: boolean
  /** A layer's class as the component is styled: its CSS module class, or its utilities. */
  classOf: (className: string) => es.SyntaxNode
  /** The layer each JSX element draws, which code links back to. */
  layers: WeakMap<es.SyntaxNode, string>
  /** Effects of the `shaders` library its layers fill with. */
  shaders: Set<string>
  /** The function the code merges class names with, if it has one (`cn`). */
  classNames?: { module: string; name: string }
}

/** Several classes on one element, skipping a caller's that is absent. */
const JOINED = es.parseExpression("$classes.filter(Boolean).join(' ')")

/**
 * Several sources of classes as one `className` value: the code's own merge function when it has
 * one (`cn('…', props.className)`), whose import is recorded, or else joined in place.
 */
export function mergedClasses(classes: es.SyntaxNode[], uses: MarkupUses): es.SyntaxNode {
  const merge = uses.classNames
  if (!merge) return es.fill(JOINED, { $classes: es.array(classes) })
  const imported = uses.connected.get(merge.module) ?? new Set()
  imported.add(merge.name)
  uses.connected.set(merge.module, imported)
  return {
    type: 'CallExpression',
    callee: es.identifier(merge.name),
    arguments: classes,
    optional: false
  }
}

export const numeric = (name: string, value: number) =>
  jsx.attribute(name, jsx.container(es.number(value)))

/** A `className` value: a plain string as an attribute string, anything else in braces. */
export function classValue(value: es.SyntaxNode): es.SyntaxNode {
  return value.type === 'Literal' && typeof value.value === 'string'
    ? jsx.stringValue(value.value)
    : jsx.container(value)
}

/** `element`, recorded as drawing `layerId`, so code can link back to that layer. */
export function drawing(
  element: es.SyntaxNode,
  layerId: string | undefined,
  uses: MarkupUses
): es.SyntaxNode {
  if (layerId) uses.layers.set(element, layerId)
  return element
}

/** The layer of each JSX element in `program`, in the order the elements open. */
export function elementLayers(
  program: es.SyntaxNode,
  layers: WeakMap<es.SyntaxNode, string>
): (string | null)[] {
  const found: (string | null)[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!es.isNode(value)) return
    if (value.type === 'JSXElement') found.push(layers.get(value) ?? null)
    for (const item of Object.values(value)) visit(item)
  }
  visit(program)
  return found
}
