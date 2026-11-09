import * as v from 'valibot'

/** A `$name` placeholder: a property of the component, by its name with only word characters. */
export const CODE_CONNECT_HOLE = /^\$\w+$/

const identifierSchema = v.pipe(v.string(), v.regex(/^[A-Za-z_$][\w$]*$/))

/**
 * How an instance of a main component or component set is written as code: a JSX element with
 * `$name` holes that the instance's properties fill, and where its components are imported from.
 */
export const codeConnectSchema = v.object({
  version: v.literal(1),
  imports: v.array(
    v.object({
      module: v.pipe(v.string(), v.nonEmpty(), v.maxLength(512)),
      names: v.pipe(v.array(identifierSchema), v.minLength(1))
    })
  ),
  template: v.pipe(v.string(), v.nonEmpty(), v.maxLength(10_000)),
  /** Values the code component defaults to, by hole; a hole filled with its default is left out. */
  defaults: v.optional(v.record(v.string(), v.union([v.string(), v.boolean()])), {})
})

export type CodeConnect = v.InferOutput<typeof codeConnectSchema>
