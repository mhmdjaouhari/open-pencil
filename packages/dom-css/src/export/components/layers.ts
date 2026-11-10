import { stateStylesToCSS } from '#dom-css/behaviours/states/css'
import { restLayerOf, stateStyles } from '#dom-css/behaviours/states/model'
import { stateStylesToTailwind } from '#dom-css/behaviours/states/tailwind'
import type { StateElement, StateNode, StateStyles } from '#dom-css/behaviours/states/types'
import { DesignTokens } from '#dom-css/tokens/references'
import type { DesignDocument, DesignElement, DesignNode } from '#dom-css/types'
import { uniq, zip } from 'es-toolkit/array'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { extractImageAssets, type ExportHTMLFile } from '../bundle'
import { serializedElements, serializeHTML } from '../html'
import type { SceneGraphToDesignOptions } from '../projection'
import { claimName, identifierName } from '../storybook/names'
import { codeConventions } from './connect'
import { componentModel, type ComponentGeneratorOptions, type GeneratedComponent } from './model'
import { reactComponent, reactUsage } from './react'
import { connectedSelection } from './usage'
import { vueComponent } from './vue'

/** The frameworks a layer can be generated as a component for. */
export const LAYER_COMPONENT_FRAMEWORKS = ['vue', 'react'] as const
export type LayerComponentFramework = (typeof LAYER_COMPONENT_FRAMEWORKS)[number]

/** A layer as a component: its name and the files that make it up. */
export interface LayerComponent {
  name: string
  layerId: string
  files: GeneratedComponent['files']
}

/**
 * Each layer as a Vue or React component, as the Storybook export generates a component set's:
 * a component set with its variants as props and its behaviour's parts, and any other layer as
 * a plain component of the elements it draws. Names stay distinct across the layers.
 */
export async function layerComponents(
  graph: SceneGraph,
  layerIds: readonly string[],
  framework: LayerComponentFramework,
  options: Pick<SceneGraphToDesignOptions, 'vectorElement'> & ComponentGeneratorOptions = {}
): Promise<LayerComponent[]> {
  const generate = framework === 'vue' ? vueComponent : reactComponent
  // What the options leave unsaid, the code the document's components are connected to says.
  const conventions = codeConventions(graph)
  const classNames = options.classNames ?? conventions?.classNames
  const inheritedFontFamily = options.inheritedFontFamily ?? conventions?.inheritedFontFamily
  // The document's tokens are the code's theme, as the stylesheet the export writes declares them.
  const tokens = new DesignTokens(graph)
  const modeClasses = tokens.modeClasses(options.modeVariants ?? conventions?.modeVariants ?? {})
  // A token written as a class per mode is those tokens' utilities, not one of its own.
  const themeVariables = uniq([
    ...tokens.themeVariables(),
    ...(options.themeVariables ?? [])
  ]).filter((variable) => !modeClasses.has(variable))
  const taken = new Set<string>()
  const components: LayerComponent[] = []
  for (const layerId of layerIds) {
    const layer = graph.getNode(layerId)
    if (!layer) continue
    const name = claimName(identifierName(layer.name, 'Component'), taken)
    // Instances standing for code components are written as them, in JSX only.
    const model = componentModel(graph, layer, {
      ...options,
      name,
      codeConnect: framework === 'react'
    })
    if (!model) continue
    const generatorOptions = {
      styling: options.styling,
      themeVariables,
      inheritedFontFamily,
      modeClasses,
      classNames
    }
    // An instance of a code component is shown as that component used, not redrawn.
    const connected = framework === 'react' ? connectedSelection(graph, layer, model.tree) : null
    if (connected) {
      components.push({ name, layerId, files: [reactUsage(model, connected, generatorOptions)] })
      continue
    }
    const { files } = await generate(model, generatorOptions)
    components.push({ name, layerId, files })
  }
  return components
}

/** Layers as HTML and the stylesheet that styles it, and the images it points at. */
export interface LayerMarkup {
  html: string
  /** The layer each element of `html` draws, in the order they open, `null` for none. */
  layerIds: (string | null)[]
  css: string
  images: ExportHTMLFile[]
}

/** The state element each element of markup built from it draws, which it builds one for one. */
function drawnBy(
  state: StateNode,
  design: DesignNode,
  found: Map<DesignElement, StateElement>
): void {
  if (state.type === 'text' || design.type === 'text') return
  found.set(design, state)
  for (const [child, built] of zip(state.children, design.children)) drawnBy(child, built, found)
}

/** The layer of each element `serializeHTML` writes for the document, in the order they open. */
function markupLayers(graph: SceneGraph, styles: StateStyles, document: DesignDocument) {
  const states = new Map<DesignElement, StateElement>()
  for (const root of document.children) drawnBy(styles.root, root, states)
  return serializedElements(document).map((element) => {
    const state = element && states.get(element)
    return (state && restLayerOf(graph, styles, state)) ?? null
  })
}

/**
 * Layers as indented HTML with a readable class per layer and one stylesheet, as the generated
 * components draw them, or with Tailwind utilities in place of the classes and no stylesheet.
 * Images are files under `assetBasePath` rather than inlined.
 */
export async function layerMarkup(
  graph: SceneGraph,
  layerIds: readonly string[],
  options: Pick<SceneGraphToDesignOptions, 'vectorElement'> &
    ComponentGeneratorOptions & { assetBasePath?: string } = {}
): Promise<LayerMarkup> {
  const taken = new Set<string>()
  const html: string[] = []
  const layers: (string | null)[] = []
  const css: string[] = []
  for (const layerId of layerIds) {
    const layer = graph.getNode(layerId)
    const styles = layer && stateStyles(graph, layer, options)
    if (!layer || !styles) continue
    // Two layers named alike would share class names, and their rules would collide.
    const name = claimName(styles.name, taken, { separator: ' ' })
    const named = { ...styles, name }
    const sheet =
      options.styling === 'tailwind'
        ? { document: stateStylesToTailwind(named), css: '' }
        : await stateStylesToCSS(named)
    html.push(serializeHTML(sheet.document, { indent: true }))
    layers.push(...markupLayers(graph, named, sheet.document))
    if (sheet.css) css.push(sheet.css)
  }
  const { html: page, files } = extractImageAssets(
    html.join('\n\n'),
    options.assetBasePath ?? 'assets'
  )
  return { html: page, layerIds: layers, css: css.join('\n'), images: files }
}
