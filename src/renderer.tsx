import React from 'react'
import * as runtime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { Pre } from 'codehike/code'
import type { HighlightedCode } from 'codehike/code'

function Code({ codeblock }: { codeblock: HighlightedCode }) {
  return React.createElement(Pre, { code: codeblock })
}

// Placeholder for components the MDX references but the plugin cannot resolve
// (custom React components defined in the author's own app). Renders the
// component name, any simple attributes, and its children so the content stays
// previewable instead of throwing "Expected component X to be defined".
function makeFallback(name: string) {
  return function MdxFallback(props: Record<string, unknown>) {
    const { children, ...rest } = props
    const attrs = Object.entries(rest).filter(
      ([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    )
    return React.createElement(
      'div',
      { className: 'mdx-fallback' },
      React.createElement(
        'div',
        { className: 'mdx-fallback-head' },
        React.createElement('span', { className: 'mdx-fallback-name' }, name),
        ...attrs.map(([k, v]) =>
          React.createElement('span', { className: 'mdx-fallback-attr', key: k }, `${k}: ${String(v)}`)
        )
      ),
      React.createElement('div', { className: 'mdx-fallback-body' }, children as never)
    )
  }
}

// This file runs inside a sandboxed iframe — window is the iframe's own window,
// not the Obsidian host window. activeDocument/activeWindow do not exist here.
type MdxRunFn = (r: Record<string, unknown>) => { default: (p: Record<string, unknown>) => unknown }
type MdxWindow = Window & { __mdxRun?: MdxRunFn; __mdxFallbacks?: string[] }

try {
  const win = window as MdxWindow
  const mdxRun = win.__mdxRun
  if (!mdxRun) throw new Error('MDX script did not load')
  const { default: MDXContent } = mdxRun({ ...runtime })

  const components: Record<string, unknown> = { Code }
  for (const name of win.__mdxFallbacks ?? []) {
    if (!(name in components)) components[name] = makeFallback(name)
  }

  createRoot(window.document.getElementById('root') as Element).render(
    MDXContent({ components }) as never
  )
} catch (err) {
  const root = window.document.getElementById('root')
  if (root) {
    const pre = window.document.createElement('pre')
    pre.className = 'mdx-error'
    pre.textContent = 'MDX Error: ' + String(err)
    root.appendChild(pre)
  }
}
