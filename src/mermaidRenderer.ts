import mermaid from 'mermaid'
import type { MermaidConfig } from 'mermaid'

type MermaidRenderResult = Awaited<ReturnType<typeof mermaid.render>>
type MermaidWindow = Window & {
  __mdxRenderMermaid?: (
    id: string,
    chart: string,
    themeVariables: Record<string, string>,
  ) => Promise<MermaidRenderResult>
}

let currentThemeKey = ''

function mermaidConfig(themeVariables: Record<string, string>): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables,
  }
}

async function renderMermaid(
  id: string,
  chart: string,
  themeVariables: Record<string, string>,
): Promise<MermaidRenderResult> {
  const themeKey = JSON.stringify(themeVariables)
  if (themeKey !== currentThemeKey) {
    currentThemeKey = themeKey
    mermaid.initialize(mermaidConfig(themeVariables))
  }
  return mermaid.render(id, chart)
}

;(window as MermaidWindow).__mdxRenderMermaid = renderMermaid
