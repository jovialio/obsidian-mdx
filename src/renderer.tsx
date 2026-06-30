import React from 'react'
import * as runtime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { Pre } from 'codehike/code'
import type { HighlightedCode } from 'codehike/code'

function Code({ codeblock }: { codeblock: HighlightedCode }) {
  return React.createElement(Pre, { code: codeblock })
}

try {
  const body = JSON.parse(
    (document.getElementById('mdx-compiled') as HTMLElement).textContent as string
  )
  const fn = new Function(body) as (...args: unknown[]) => Record<string, unknown>
  const { default: MDXContent } = fn({ ...runtime })
  createRoot(document.getElementById('root') as Element).render(
    (MDXContent as (props: Record<string, unknown>) => unknown)({ components: { Code } }) as never
  )
} catch (err) {
  ;(document.getElementById('root') as HTMLElement).innerHTML =
    '<pre class="mdx-error">MDX Error: ' + String(err) + '</pre>'
}
