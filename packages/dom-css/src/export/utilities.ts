import { round } from 'es-toolkit/math'

/**
 * Utilities on Tailwind v4's spacing scale, where `-<n>` is `n` steps of `--spacing` (0.25rem),
 * any multiple of a quarter step: a whole number of pixels.
 */
const SPACING_UTILITIES = new Set([
  'p',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'ps',
  'pe',
  'm',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'ms',
  'me',
  'gap',
  'gap-x',
  'gap-y',
  'space-x',
  'space-y',
  'w',
  'h',
  'size',
  'min-w',
  'min-h',
  'max-w',
  'max-h',
  'inset',
  'inset-x',
  'inset-y',
  'top',
  'right',
  'bottom',
  'left',
  'start',
  'end',
  'basis',
  'leading',
  'indent',
  'translate-x',
  'translate-y'
])

/** Utilities whose `-[n]` takes a bare number as `-n`. */
const NUMBER_UTILITIES = new Set(['grow', 'shrink', 'order', 'z', 'flex'])

/** The variants before a utility (`hover:`, `group-data-[x]/root:`) and the utility itself. */
function splitVariants(className: string): [string, string] {
  let depth = 0
  let end = 0
  for (let index = 0; index < className.length; index++) {
    const char = className[index]
    if (char === '[' || char === '(') depth++
    else if (char === ']' || char === ')') depth--
    else if (char === ':' && depth === 0) end = index + 1
  }
  return [className.slice(0, end), className.slice(end)]
}

/** Lengths that layout left with float noise (`724.7999877929688px`) at two decimals. */
const roundNumbers = (value: string) =>
  value.replaceAll(/-?\d+\.\d{3,}/g, (number) => String(round(Number(number), 2)))

/**
 * A utility as the theme writes it, where twirlwind left an arbitrary value:
 * - a theme colour (`via-[var(--color-primary)]`) is its name, `via-primary`;
 * - a theme colour at an alpha (`bg-[color-mix(in_oklab,_var(--color-primary)_10%,_transparent)]`,
 *   the CSS `bg-primary/10` compiles to) is its opacity modifier, `bg-primary/10`;
 * - a whole number of pixels on the spacing scale (`gap-[6px]`, `right-[-12px]`) is a step of it,
 *   `gap-1.5`, `-right-3`;
 * - a bare number (`grow-[3]`) is itself, `grow-3`.
 */
function themeUtility(utility: string, theme: ReadonlySet<string>): string {
  const negative = utility.startsWith('-')
  const body = negative ? utility.slice(1) : utility
  const open = body.indexOf('-[')
  if (open === -1 || !body.endsWith(']')) return utility
  const name = body.slice(0, open)
  const value = roundNumbers(body.slice(open + 2, -1))
  const sign = negative ? '-' : ''
  const color = /^var\(--color-([\w-]+)\)$/.exec(value)
  if (color?.[1] && theme.has(`--color-${color[1]}`)) return `${sign}${name}-${color[1]}`
  const alpha =
    /^color-mix\(in_oklab,_var\(--color-([\w-]+)\)_(\d+(?:\.\d+)?)%,_transparent\)$/.exec(value)
  if (alpha?.[1] && alpha[2] && theme.has(`--color-${alpha[1]}`))
    return `${sign}${name}-${alpha[1]}/${alpha[2]}`
  const length = /^(-?)(\d+(?:\.\d+)?)px$/.exec(value)
  if (length && SPACING_UTILITIES.has(name)) {
    const pixels = Number(length[2])
    if (Number.isInteger(pixels)) {
      const steps = pixels / 4
      const outward = negative !== (length[1] === '-')
      return pixels === 0 ? `${name}-0` : `${outward ? '-' : ''}${name}-${steps}`
    }
  }
  if (NUMBER_UTILITIES.has(name) && /^\d+$/.test(value)) return `${sign}${name}-${value}`
  return `${sign}${name}-[${value}]`
}

/**
 * twirlwind's utilities written as the theme writes them (`themeUtility`), with layout's float
 * noise rounded off, and without `box-border`, which Tailwind's preflight gives every element.
 */
export function tidyUtilities(
  classes: readonly string[],
  themeVariables: readonly string[]
): string[] {
  const theme = new Set(themeVariables)
  return classes.flatMap((className) => {
    const [variants, utility] = splitVariants(className)
    if (utility === 'box-border') return []
    return [`${variants}${themeUtility(utility, theme)}`]
  })
}

/** Declarations without a `font-family` the page already sets, which the element inherits. */
export function withoutInheritedFont(
  style: Partial<Record<string, string>>,
  inheritedFontFamily: string | undefined
): Partial<Record<string, string>> {
  const family = style['font-family']
  if (!inheritedFontFamily || family === undefined) return style
  const [first = ''] = family.split(',')
  const name = first.trim().replaceAll(/^["']|["']$/g, '')
  if (name.toLowerCase() !== inheritedFontFamily.toLowerCase()) return style
  const { 'font-family': _inherited, ...rest } = style
  return rest
}
