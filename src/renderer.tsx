import React from 'react'
import * as runtime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { Pre } from 'codehike/code'
import type { HighlightedCode } from 'codehike/code'

function Code({ codeblock }: { codeblock: HighlightedCode }) {
  return React.createElement(Pre, { code: codeblock })
}

// This module runs inside a sandboxed iframe (null origin, no Obsidian APIs).
// `document` is correct here — activeDocument applies only to Obsidian plugin context.
// `new Function` is required to execute the compiled MDX function-body output.
/* eslint-disable no-undef, @typescript-eslint/no-implied-eval */
try {
  const compiled = document.getElementById('mdx-compiled')
  const body = JSON.parse(compiled?.textContent ?? '') as string
  // eslint-disable-next-line @typescript-eslint/no-new-func
  const fn = new Function(body) as (...args: unknown[]) => Record<string, unknown>
  const { default: MDXContent } = fn({ ...runtime })
  createRoot(document.getElementById('root') as Element).render(
    (MDXContent as (props: Record<string, unknown>) => unknown)({ components: { Code } }) as never
  )
} catch (err) {
  const root = document.getElementById('root')
  if (root) {
    const pre = document.createElement('pre')
    pre.className = 'mdx-error'
    pre.textContent = 'MDX Error: ' + String(err)
    root.appendChild(pre)
  }
}
/* eslint-enable no-undef, @typescript-eslint/no-implied-eval */
