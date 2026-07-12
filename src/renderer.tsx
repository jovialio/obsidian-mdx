import React from 'react'
import * as runtime from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { Pre } from 'codehike/code'
import type { HighlightedCode } from 'codehike/code'

function Code({ codeblock }: { codeblock: HighlightedCode }) {
  return React.createElement(Pre, { code: codeblock })
}

// A step's code can be a single highlighted block or, when the author uses
// Code Hike's multi-value marker (!!code) to show several files in one step,
// an array of them. Both shapes must be handled.
type StepCode = HighlightedCode | HighlightedCode[]

// The plugin keys the map by the decoded source, so decode before looking up
// (compiled MDX percent-encodes spaces from angle-bracketed links). Returns the
// mapped resource URL, or null when there is nothing to rewrite.
function mappedImageSource(raw: string, map: Record<string, string>): string | null {
  let decoded = raw
  try {
    decoded = decodeURI(raw)
  } catch {
    // Malformed escape — fall back to the raw src for the lookup.
  }
  const mapped = map[decoded] ?? map[raw]
  return mapped && mapped !== raw ? mapped : null
}

// Rewrite the src of every <img> under `root` from the map. Used for literal
// JSX <img> tags, which MDX compiles to intrinsic React elements that bypass
// the `components.img` override below.
function applyImageSources(root: ParentNode, map: Record<string, string>): void {
  root.querySelectorAll('img').forEach((img) => {
    const raw = img.getAttribute('src')
    if (!raw) return
    const mapped = mappedImageSource(raw, map)
    if (mapped) img.setAttribute('src', mapped)
  })
}

function Image(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const imageSources = (window as MdxWindow).__mdxImageSources ?? {}
  const src =
    typeof props.src === 'string' ? mappedImageSource(props.src, imageSources) ?? props.src : props.src

  return React.createElement('img', { ...props, src })
}

type ScrollyStep = {
  title?: string
  children?: React.ReactNode
  code?: StepCode
  codeblock?: StepCode
}

function Slot({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children)
}

function getStepCode(step: ScrollyStep): StepCode | undefined {
  return step.code ?? step.codeblock
}

// Render a step's code. Pre expects a single highlighted block, so an array
// (multi-file step) is rendered as stacked blocks rather than passed straight
// through — passing the array would throw on the missing `tokens` and blank
// the whole preview.
function renderStepCode(code: StepCode | undefined): React.ReactNode {
  if (!code) return null
  const blocks = Array.isArray(code) ? code : [code]
  return blocks.map((block, index) => React.createElement(Pre, { code: block, key: index }))
}

function Scrollycoding({
  title,
  steps,
  children,
}: {
  title?: string
  steps?: ScrollyStep[]
  children?: React.ReactNode
}) {
  const safeSteps = Array.isArray(steps) ? steps : []
  const [activeIndex, setActiveIndex] = React.useState(0)
  const stepRefs = React.useRef<Array<HTMLDivElement | null>>([])

  React.useEffect(() => {
    if (safeSteps.length === 0 || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const index = visible?.target.getAttribute('data-step-index')
        if (index) setActiveIndex(Number(index))
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    )

    stepRefs.current.forEach((el) => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [safeSteps.length])

  if (safeSteps.length === 0) {
    return React.createElement(
      'section',
      { className: 'mdx-scrollycoding mdx-scrollycoding-static' },
      title ? React.createElement('h3', { className: 'mdx-scrollycoding-title' }, title) : null,
      children
    )
  }

  const boundedActive = Math.min(Math.max(activeIndex, 0), safeSteps.length - 1)
  const activeCode = getStepCode(safeSteps[boundedActive])

  return React.createElement(
    'section',
    { className: 'mdx-scrollycoding' },
    title ? React.createElement('h3', { className: 'mdx-scrollycoding-title' }, title) : null,
    React.createElement(
      'div',
      { className: 'mdx-scrollycoding-grid' },
      React.createElement(
        'div',
        { className: 'mdx-scrollycoding-steps' },
        ...safeSteps.map((step, index) =>
          React.createElement(
            'div',
            {
              className:
                'mdx-scrollycoding-step' +
                (index === boundedActive ? ' mdx-scrollycoding-step-active' : ''),
              'data-step-index': String(index),
              key: index,
              ref: (el: HTMLDivElement | null) => {
                stepRefs.current[index] = el
              },
            },
            step.title
              ? React.createElement('h4', { className: 'mdx-scrollycoding-step-title' }, step.title)
              : null,
            step.children
          )
        )
      ),
      React.createElement(
        'div',
        { className: 'mdx-scrollycoding-code' },
        renderStepCode(activeCode)
      )
    )
  )
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

// Renders YAML frontmatter as a key/value properties table above the content,
// mirroring Obsidian's reading view. Array values are comma-joined; objects are
// shown as JSON. React escapes all values, so untrusted frontmatter is safe.
function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function FrontmatterTable({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data)
  if (rows.length === 0) return null
  return React.createElement(
    'table',
    { className: 'mdx-frontmatter' },
    React.createElement(
      'tbody',
      null,
      ...rows.map(([key, value]) =>
        React.createElement(
          'tr',
          { key },
          React.createElement('th', null, key),
          React.createElement('td', null, formatValue(value))
        )
      )
    )
  )
}

// This file runs inside a sandboxed iframe — window is the iframe's own window,
// not the Obsidian host window. activeDocument/activeWindow do not exist here.
type MdxRunFn = (r: Record<string, unknown>) => { default: (p: Record<string, unknown>) => unknown }
type MdxWindow = Window & {
  __mdxRun?: MdxRunFn
  __mdxFallbacks?: string[]
  __mdxFrontmatter?: Record<string, unknown> | null
  __mdxImageSources?: Record<string, string>
}

try {
  const win = window as MdxWindow
  const mdxRun = win.__mdxRun
  if (!mdxRun) throw new Error('MDX script did not load')
  const { default: MDXContent } = mdxRun({ ...runtime })

  const components: Record<string, unknown> = {
    Code,
    img: Image,
    Scrollycoding,
    ScrollyCoding: Scrollycoding,
    slot: Slot,
  }
  for (const name of win.__mdxFallbacks ?? []) {
    if (!(name in components)) components[name] = makeFallback(name)
  }

  const frontmatter = win.__mdxFrontmatter
  const imageSources = win.__mdxImageSources ?? {}
  const rootEl = window.document.getElementById('root') as Element

  // Literal JSX <img> tags bypass the components map, and images can also mount
  // asynchronously, so watch the tree and rewrite any local srcs in the DOM.
  // setAttribute only mutates attributes, which this observer ignores, so the
  // rewrite cannot retrigger itself.
  const imageObserver = new MutationObserver(() => applyImageSources(rootEl, imageSources))
  imageObserver.observe(rootEl, { childList: true, subtree: true })

  createRoot(rootEl).render(
    React.createElement(
      React.Fragment,
      null,
      frontmatter ? React.createElement(FrontmatterTable, { data: frontmatter }) : null,
      React.createElement('div', { className: 'markdown-body' }, MDXContent({ components }) as never)
    ) as never
  )
  applyImageSources(rootEl, imageSources)
} catch (err) {
  const root = window.document.getElementById('root')
  if (root) {
    const pre = window.document.createElement('pre')
    pre.className = 'mdx-error'
    pre.textContent = 'MDX Error: ' + String(err)
    root.appendChild(pre)
  }
}
