import { compact } from 'es-toolkit/array'

import type { Effect, Fill, SceneNode, Stroke, TextLength } from '@open-pencil/scene-graph'
import { colorToCSS, colorToHex } from '@open-pencil/scene-graph/color'
import { blurSigma } from '@open-pencil/scene-graph/geometry'
import { gradientPoint } from '@open-pencil/scene-graph/gradient'
import type { Color, Vector } from '@open-pencil/scene-graph/primitives'

import type { DesignStyleDeclaration } from '../types'

/** Opaque colors as hex, which Tailwind matches to its palette; translucent ones as `rgba()`. */
export function cssColor(color: Color): string {
  return color.a >= 1 ? colorToHex(color) : colorToCSS(color)
}

export function fillToCSS(fill: Fill | undefined): string | undefined {
  if (fill?.type !== 'SOLID' || !fill.visible) return undefined
  return cssColor({ ...fill.color, a: fill.opacity })
}

export type BorderSide = 'top' | 'right' | 'bottom' | 'left'

/**
 * The width of each side of the border a layer's first stroke projects as, zero without one. A
 * border insets the box its absolutely positioned children are placed in, where a stroke does not.
 */
export function borderWidths(node: SceneNode): Record<BorderSide, number> {
  if (!strokeColorToCSS(node.strokes.at(0))) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (!node.independentStrokeWeights) {
    const weight = node.strokes[0]?.weight ?? 0
    return { top: weight, right: weight, bottom: weight, left: weight }
  }
  return {
    top: node.borderTopWeight,
    right: node.borderRightWeight,
    bottom: node.borderBottomWeight,
    left: node.borderLeftWeight
  }
}

export function strokeColorToCSS(stroke: Stroke | undefined): string | undefined {
  if (!stroke?.visible) return undefined
  return cssColor({ ...stroke.color, a: stroke.opacity })
}

/** A bound field's CSS: `var()` where its variable draws the value, else the literal. */
export type EffectFieldCSS = (field: string, literal: string) => string

const LITERAL: EffectFieldCSS = (_field, literal) => literal

function px(value: number): string {
  return `${Number(value.toFixed(3))}px`
}

/**
 * An effect's blur as a CSS length of `sigmas` times the Gaussian the canvas blurs it by: a
 * literal length, or the bound variable, whose value is a Figma radius, scaled in `calc()`.
 */
function blurLength(effect: Effect, index: number, css: EffectFieldCSS, sigmas: number): string {
  const literal = `${effect.radius}px`
  const bound = css(`effects/${index}/radius`, literal)
  if (bound !== literal) return `calc(${bound} * ${Number((sigmas * blurSigma(1)).toFixed(6))})`
  return px(sigmas * blurSigma(effect.radius))
}

/**
 * A shadow as `box-shadow` writes it, or as `text-shadow` does without its spread. CSS blurs a
 * shadow by half its blur length, so the length is twice the sigma the canvas blurs it by.
 */
function shadowToCSS(effect: Effect, index: number, css: EffectFieldCSS, spread = true): string {
  const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : ''
  const length = (property: string, value: number) =>
    css(`effects/${index}/${property}`, `${value}px`)
  const parts = [
    `${inset}${length('offsetX', effect.offset.x)}`,
    length('offsetY', effect.offset.y),
    blurLength(effect, index, css, 2)
  ]
  if (spread) parts.push(length('spread', effect.spread))
  parts.push(css(`effects/${index}/color`, cssColor(effect.color)))
  return parts.join(' ')
}

/** A blur as CSS's `blur()` takes it: the sigma itself, as the canvas blurs by. */
function blurToCSS(effect: Effect, index: number, css: EffectFieldCSS): string {
  return `blur(${blurLength(effect, index, css, 1)})`
}

const isShadow = (effect: Effect) => effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'

/** The visible effects with the index a bound field names them by. */
function visibleEffects(effects: Effect[]): [number, Effect][] {
  return [...effects.entries()].filter(([, effect]) => effect.visible)
}

/**
 * The blurs as the canvas draws them: the first visible layer blur as `filter`, and every
 * background blur in turn as `backdrop-filter`.
 */
function addBlurs(
  style: DesignStyleDeclaration,
  visible: [number, Effect][],
  css: EffectFieldCSS
): void {
  const layer = visible.find(
    ([, effect]) => effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR'
  )
  if (layer) style.filter = blurToCSS(layer[1], layer[0], css)
  const backdrop = visible.filter(([, effect]) => effect.type === 'BACKGROUND_BLUR')
  if (backdrop.length > 0) {
    style['backdrop-filter'] = backdrop
      .map(([index, effect]) => blurToCSS(effect, index, css))
      .join(' ')
  }
}

/**
 * Every visible shadow, in order, plus layer and background blur. `css` names the variable a
 * bound field, such as `effects/0/radius`, draws from.
 */
export function effectsToCSS(effects: Effect[], css = LITERAL): DesignStyleDeclaration {
  const style: DesignStyleDeclaration = {}
  const visible = visibleEffects(effects)
  const shadows = visible.filter(([, effect]) => isShadow(effect))
  if (shadows.length > 0)
    style['box-shadow'] = shadows
      .map(([index, effect]) => shadowToCSS(effect, index, css))
      .join(', ')
  addBlurs(style, visible, css)
  return style
}

/**
 * Text's effects: each visible drop shadow as `text-shadow`, which has no spread and shadows the
 * glyphs, and its layer and background blurs. An inner shadow has no form CSS gives text.
 */
export function textEffectsToCSS(effects: Effect[], css = LITERAL): DesignStyleDeclaration {
  const style: DesignStyleDeclaration = {}
  const visible = visibleEffects(effects)
  const shadows = visible.filter(([, effect]) => effect.type === 'DROP_SHADOW')
  if (shadows.length > 0) {
    style['text-shadow'] = shadows
      .map(([index, effect]) => shadowToCSS(effect, index, css, false))
      .join(', ')
  }
  addBlurs(style, visible, css)
  return style
}

/** A line height as CSS writes it: a percent as the unitless multiple that follows the font size. */
export function lineHeightToCSS(length: TextLength): string {
  return length.unit === 'PIXELS' ? `${length.value}px` : String(length.value / 100)
}

/** A letter spacing as CSS writes it: a percent of the font size in `em`. */
export function letterSpacingToCSS(length: TextLength): string {
  return length.unit === 'PIXELS' ? `${length.value}px` : `${length.value / 100}em`
}

/** A share of the layer's box as a CSS percentage. */
function percent(value: number): string {
  return `${Number((value * 100).toFixed(3))}%`
}

/** A stop's colour as CSS writes it, given its literal colour and its index: a token, or that. */
export type StopColorCSS = (stop: number, literal: string) => string

/**
 * The stops, each at `place(position)`, its own position unless the gradient line differs.
 * Stops spread evenly from end to end, as most are, leave their positions to CSS, which spreads
 * them so; then `bg-linear-to-tl from-… via-… to-…` says it.
 */
function gradientStopsCSS(
  fill: Fill,
  place: (position: number) => number = (p) => p,
  color: StopColorCSS = (_, literal) => literal
): string {
  const stops = fill.gradientStops ?? []
  const positions = stops.map((stop) => place(stop.position))
  const even =
    stops.length > 1 &&
    positions.every((position, index) => Math.abs(position - index / (stops.length - 1)) < 0.001)
  return stops
    .map((stop, index) => {
      const value = color(index, cssColor({ ...stop.color, a: stop.color.a * fill.opacity }))
      return even ? value : `${value} ${percent(positions[index] ?? 0)}`
    })
    .join(', ')
}

const SIDES = { x: ['left', '', 'right'], y: ['top', '', 'bottom'] } as const

/** Where a point lies along an axis of the box: its start (0), middle (1), or end (2), or between. */
function edge(value: number): number {
  if (value < 0.001) return 0
  if (value > 0.999) return 2
  return Math.abs(value - 0.5) < 0.001 ? 1 : -1
}

/**
 * `to top left`, `to right`, …: the direction a linear gradient runs in when it starts on one
 * side or corner of its box and ends on the opposite one, as CSS's keywords run.
 */
function keywordDirection(start: Vector, end: Vector): string | undefined {
  const [sx, sy, ex, ey] = [edge(start.x), edge(start.y), edge(end.x), edge(end.y)]
  if ([sx, sy, ex, ey].includes(-1) || sx + ex !== 2 || sy + ey !== 2) return undefined
  if (sx === 1 && sy === 1) return undefined
  return `to ${compact([SIDES.y[ey], SIDES.x[ex]]).join(' ')}`
}

/**
 * Where a linear gradient's stops fall on CSS's gradient line, which runs through the box's
 * centre at the gradient's angle and ends where the corners meet it: a stop at `position` along
 * the paint's own handles lands at the share of that line its point lies at, so the colours sit
 * where the canvas draws them whatever the angle and the box.
 */
function cssLinePosition(
  fill: Fill,
  width: number,
  height: number,
  angle: number
): (position: number) => number {
  const t = fill.gradientTransform
  if (!t || width <= 0 || height <= 0) return (position) => position
  const start = gradientPoint(t, { x: 0, y: 0.5 })
  const end = gradientPoint(t, { x: 1, y: 0.5 })
  const radians = (angle * Math.PI) / 180
  const direction = { x: Math.sin(radians), y: -Math.cos(radians) }
  const length = Math.abs(width * direction.x) + Math.abs(height * direction.y)
  return (position) => {
    const x = (start.x + (end.x - start.x) * position) * width - width / 2
    const y = (start.y + (end.y - start.y) * position) * height - height / 2
    return (x * direction.x + y * direction.y) / length + 0.5
  }
}

/**
 * The CSS angle of a linear or angular gradient across a `width` by `height` box: 0deg points
 * up and 90deg right, measured from where the gradient starts to where it ends.
 */
function gradientAngle(fill: Fill, width: number, height: number): number {
  const t = fill.gradientTransform
  if (!t) return 90
  const start = gradientPoint(t, { x: 0, y: 0.5 })
  const end = gradientPoint(t, { x: 1, y: 0.5 })
  const degrees =
    (Math.atan2((end.x - start.x) * width, -(end.y - start.y) * height) * 180) / Math.PI
  return Number((((degrees % 360) + 360) % 360).toFixed(3))
}

/** A gradient fill as a CSS image over a `width` by `height` box, or undefined for a diamond. */
export function gradientToCSS(
  fill: Fill,
  width: number,
  height: number,
  color?: StopColorCSS
): string | undefined {
  const t = fill.gradientTransform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
  const center = gradientPoint(t, { x: 0.5, y: 0.5 })
  if (fill.type === 'GRADIENT_LINEAR') {
    // From side to side or corner to corner, CSS's line runs where the handles do, whatever the box.
    const direction = fill.gradientTransform
      ? keywordDirection(gradientPoint(t, { x: 0, y: 0.5 }), gradientPoint(t, { x: 1, y: 0.5 }))
      : 'to right'
    if (direction)
      return `linear-gradient(${direction}, ${gradientStopsCSS(fill, undefined, color)})`
    const angle = gradientAngle(fill, width, height)
    const stops = gradientStopsCSS(fill, cssLinePosition(fill, width, height, angle), color)
    return `linear-gradient(${angle}deg, ${stops})`
  }
  if (fill.type === 'GRADIENT_RADIAL') {
    const right = gradientPoint(t, { x: 1, y: 0.5 })
    const bottom = gradientPoint(t, { x: 0.5, y: 1 })
    const rx = Math.hypot(right.x - center.x, right.y - center.y)
    const ry = Math.hypot(bottom.x - center.x, bottom.y - center.y)
    const shape = `${percent(rx)} ${percent(ry)} at ${percent(center.x)} ${percent(center.y)}`
    return `radial-gradient(${shape}, ${gradientStopsCSS(fill, undefined, color)})`
  }
  if (fill.type === 'GRADIENT_ANGULAR') {
    const from = gradientAngle(fill, width, height)
    const at = `${percent(center.x)} ${percent(center.y)}`
    return `conic-gradient(from ${from}deg at ${at}, ${gradientStopsCSS(fill, undefined, color)})`
  }
  return undefined
}
