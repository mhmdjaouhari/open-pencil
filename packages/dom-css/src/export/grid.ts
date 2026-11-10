import type { GridTrack, SceneNode } from '@open-pencil/scene-graph'

import type { DesignStyleDeclaration } from '../types'

/** A share track no wider than its share (`minmax(0,…)`), as auto layout's never grows with content. */
function trackToCSS(track: GridTrack): string {
  if (track.sizing === 'FR') return `minmax(0,${track.value}fr)`
  if (track.sizing === 'FIXED') return `${track.value}px`
  return 'auto'
}

/** Tracks CSS makes anyway: every one sized by its content, as implicit tracks are. */
const implicit = (tracks: GridTrack[]) => tracks.every((track) => track.sizing === 'AUTO')

/** Equal `1fr` tracks use Tailwind's `grid-cols-N` form, which keeps them from overflowing. */
function tracksToCSS(tracks: GridTrack[]): string {
  if (tracks.every((track) => track.sizing === 'FR' && track.value === 1))
    return `repeat(${tracks.length}, minmax(0, 1fr))`
  return tracks.map(trackToCSS).join(' ')
}

export function addGridContainer(
  style: DesignStyleDeclaration,
  node: SceneNode,
  css: (field: string, literal: string) => string
): void {
  style.display = 'grid'
  if (node.gridTemplateColumns.length > 0 && !implicit(node.gridTemplateColumns))
    style['grid-template-columns'] = tracksToCSS(node.gridTemplateColumns)
  if (node.gridTemplateRows.length > 0 && !implicit(node.gridTemplateRows))
    style['grid-template-rows'] = tracksToCSS(node.gridTemplateRows)
  if (node.gridColumnGap > 0) style['column-gap'] = css('gridColumnGap', `${node.gridColumnGap}px`)
  if (node.gridRowGap > 0) style['row-gap'] = css('gridRowGap', `${node.gridRowGap}px`)
}

/** A span sets the whole placement, so the start follows it. */
export function addGridPlacement(style: DesignStyleDeclaration, node: SceneNode): void {
  const position = node.gridPosition
  if (!position) return
  if (position.columnSpan > 1)
    style['grid-column'] = `span ${position.columnSpan} / span ${position.columnSpan}`
  if (position.column > 0) style['grid-column-start'] = String(position.column)
  if (position.rowSpan > 1)
    style['grid-row'] = `span ${position.rowSpan} / span ${position.rowSpan}`
  if (position.row > 0) style['grid-row-start'] = String(position.row)
}
