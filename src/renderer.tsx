import * as runtime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { CH } from '@code-hike/mdx/components'

try {
  const body = JSON.parse(
    (document.getElementById('mdx-compiled') as HTMLElement).textContent as string
  )
  const fn = new Function(body) as (...args: unknown[]) => Record<string, unknown>
  const { default: MDXContent } = fn({ ...runtime })
  createRoot(document.getElementById('root') as Element).render(
    (MDXContent as (props: Record<string, unknown>) => unknown)({ components: { CH } }) as never
  )
} catch (err) {
  ;(document.getElementById('root') as HTMLElement).innerHTML =
    '<pre class="mdx-error">MDX Error: ' + String(err) + '</pre>'
}
