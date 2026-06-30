import React from 'react'
import * as runtime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { Pre } from 'codehike/code'
import type { HighlightedCode } from 'codehike/code'

function Code({ codeblock }: { codeblock: HighlightedCode }) {
  return React.createElement(Pre, { code: codeblock })
}

// This file runs inside a sandboxed iframe (sandbox="allow-scripts", null origin).
// It has no access to the Obsidian plugin host or its globals. `activeDocument`
// does not exist in this context — `globalThis.document` is the iframe's own DOM.
const doc = globalThis.document

try {
  const compiled = doc.getElementById('mdx-compiled')
  const body = JSON.parse(compiled?.textContent ?? '') as string
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval -- only viable way to execute @mdx-js/mdx function-body output; runs inside sandboxed iframe with no module loader
  const fn = new Function(body) as (...args: unknown[]) => Record<string, unknown>
  const { default: MDXContent } = fn({ ...runtime })
  createRoot(doc.getElementById('root') as Element).render(
    (MDXContent as (props: Record<string, unknown>) => unknown)({ components: { Code } }) as never
  )
} catch (err) {
  const root = doc.getElementById('root')
  if (root) {
    const pre = doc.createElement('pre')
    pre.className = 'mdx-error'
    pre.textContent = 'MDX Error: ' + String(err)
    root.appendChild(pre)
  }
}
