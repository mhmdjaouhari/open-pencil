import { defineRule } from '#core/lint/rule'

/**
 * In a document built from a component library, components of its own are proposals until the
 * library takes them in: the library is the design system, and code export writes its
 * components. A document without a library enabled has nothing to compare with.
 */
export default defineRule({
  meta: {
    id: 'library-components',
    category: 'components',
    description: "Components and instances should come from the document's component libraries"
  },
  match: ['COMPONENT', 'COMPONENT_SET', 'INSTANCE'],
  check(node, context) {
    if (!context.usesLibraries || node.fromLibrary !== false) return
    if (node.type === 'INSTANCE') {
      context.report({
        node,
        message: `"${node.name}" is an instance of a local component`,
        suggest: "Use the library's component, or propose this one for the library"
      })
      return
    }
    // A variant is reported with its set.
    if (node.type === 'COMPONENT' && context.getParent(node)?.type === 'COMPONENT_SET') return
    context.report({
      node,
      message: `"${node.name}" is a local component, not one of the library's`,
      suggest: 'Propose it for the library, then use the published component'
    })
  }
})
