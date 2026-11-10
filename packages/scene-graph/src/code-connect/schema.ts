import * as v from 'valibot'

/** A `$name` placeholder: a property of the component, by its name with only word characters. */
export const CODE_CONNECT_HOLE = /^\$\w+$/

const identifierSchema = v.pipe(v.string(), v.regex(/^[A-Za-z_$][\w$]*$/))
const moduleSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(512))

/**
 * How an instance of a main component or component set is written as code: a JSX element with
 * `$name` holes that the instance's properties fill, and where its components are imported from.
 */
export const codeConnectSchema = v.object({
  version: v.literal(1),
  imports: v.array(
    v.object({
      module: moduleSchema,
      names: v.pipe(v.array(identifierSchema), v.minLength(1))
    })
  ),
  template: v.pipe(v.string(), v.nonEmpty(), v.maxLength(10_000)),
  /** Values the code component defaults to, by hole; a hole filled with its default is left out. */
  defaults: v.optional(v.record(v.string(), v.union([v.string(), v.boolean()])), {}),
  /** How the code the component lives in writes markup, which an export of it follows. */
  conventions: v.optional(
    v.object({
      /** The function it merges class names with, such as `cn` from `@/lib/utils`. */
      classNames: v.optional(v.object({ module: moduleSchema, name: identifierSchema })),
      /** The font family its pages set, which elements inherit rather than restate. */
      inheritedFontFamily: v.optional(v.pipe(v.string(), v.nonEmpty(), v.maxLength(256))),
      /** The Tailwind variant each variable mode is under, by mode name (`{ Dark: 'dark' }`). */
      modeVariants: v.optional(v.record(v.string(), v.pipe(v.string(), v.regex(/^[\w-]+$/))))
    })
  )
})

export type CodeConnect = v.InferOutput<typeof codeConnectSchema>
