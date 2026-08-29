import { test, expect } from '@playwright/test'
import { compile } from '@mdx-js/mdx'
import { remarkCodeHike, recmaCodeHike } from 'codehike/mdx'
import type { CodeHikeConfig } from 'codehike/mdx'
import esbuild from 'esbuild'

let rendererScript = ''
let mermaidRendererScript = ''
let printSnapshotScript = ''

const chConfig: CodeHikeConfig = {
  components: { code: 'Code' },
  syntaxHighlighting: { theme: 'github-dark' },
  ignoreCode: (codeblock) => codeblock.lang === 'mermaid',
}

const mermaidTheme = {
  background: '#ffffff',
  mainBkg: '#f2f2f2',
  primaryColor: '#f2f2f2',
  primaryTextColor: '#1e1e1e',
  primaryBorderColor: '#d0d0d0',
  secondaryColor: '#ffffff',
  tertiaryColor: '#f2f2f2',
  textColor: '#1e1e1e',
  lineColor: '#8a8a8a',
  nodeBorder: '#d0d0d0',
  clusterBkg: '#ffffff',
  clusterBorder: '#d0d0d0',
  edgeLabelBackground: '#ffffff',
  fontFamily: 'sans-serif',
}

async function buildScript(entryPoint: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    treeShaking: true,
  })
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
}

async function buildGlobalScript(entryPoint: string, globalName: string): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2020',
    write: false,
    treeShaking: true,
  })
  return result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
}

test.beforeAll(async () => {
  rendererScript = await buildScript('src/renderer.tsx')
  mermaidRendererScript = await buildScript('src/mermaidRenderer.ts')
  printSnapshotScript = await buildGlobalScript('src/printSnapshot.ts', 'printSnapshot')
})

async function buildSrcdoc(
  mdx: string,
  frontmatter: Record<string, unknown> | null = null,
  extraStyle = '',
  imageSources: Record<string, string> = {},
): Promise<string> {
  // Mirror the plugin: strip leading YAML frontmatter before compiling.
  const source = mdx.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')

  const compiled = await compile(source, {
    outputFormat: 'function-body',
    remarkPlugins: [[remarkCodeHike, chConfig]],
    recmaPlugins: [[recmaCodeHike, chConfig]],
    development: false,
  })

  const compiledBody = String(compiled).replace(/<\/script/gi, '<\\/script')

  const fallbackNames = [
    ...new Set(
      [...compiledBody.matchAll(/_missingMdxReference\(\s*["']([A-Za-z_$][\w$]*)["']/g)].map(
        (m) => m[1],
      ),
    ),
  ]
  const hasMermaid = /\blanguage-mermaid\b/.test(compiledBody)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 16px; }
    .mdx-error { color: red; white-space: pre-wrap; font-family: monospace; }
    ${extraStyle}
  </style>
</head>
<body>
  <div id="root"></div>
  <script>window.__mdxFrontmatter = ${JSON.stringify(frontmatter).replace(/<\/script/gi, '<\\/script')}</script>
  <script>window.__mdxFallbacks = ${JSON.stringify(fallbackNames).replace(/<\/script/gi, '<\\/script')}</script>
  <script>window.__mdxImageSources = ${JSON.stringify(imageSources).replace(/<\/script/gi, '<\\/script')}</script>
  <script>window.__mdxMermaidTheme = ${JSON.stringify(mermaidTheme).replace(/<\/script/gi, '<\\/script')}</script>
  ${hasMermaid ? `<script>${mermaidRendererScript}</script>` : ''}
  <script>window.__mdxRun = function() { ${compiledBody} }</script>
  <script>${rendererScript}</script>
</body>
</html>`
}

test.describe('MDX Preview rendering', () => {
  test('renders heading and paragraph', async ({ page }) => {
    const srcdoc = await buildSrcdoc('# Hello\n\nThis is **MDX**.')

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    // Content is wrapped in the .markdown-body reading container.
    await expect(iframe.locator('.markdown-body h1')).toHaveText('Hello', { timeout: 30_000 })
    await expect(iframe.locator('strong')).toHaveText('MDX')
  })

  test('does not load the Mermaid renderer for documents without diagrams', async ({ page }) => {
    const srcdoc = await buildSrcdoc('# Hello\n\nPlain MDX only.')

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const frame = page.frames().find((f) => f.parentFrame() === page.mainFrame())
    if (!frame) throw new Error('preview iframe not found')
    await expect
      .poll(
        () =>
          frame.evaluate(
            () => typeof (window as Window & { __mdxRenderMermaid?: unknown }).__mdxRenderMermaid,
          ),
        { timeout: 30_000 },
      )
      .toBe('undefined')
  })

  test('renders list items', async ({ page }) => {
    const srcdoc = await buildSrcdoc('- one\n- two\n- three')

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('li')).toHaveCount(3, { timeout: 30_000 })
  })

  test('renders Mermaid fences as diagrams', async ({ page }) => {
    const srcdoc = await buildSrcdoc(`
\`\`\`mermaid
flowchart TD
  A[Context] --> B[Prefill]
\`\`\`
`)

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.mdx-error')).toHaveCount(0, { timeout: 30_000 })
    await expect(iframe.locator('.mdx-mermaid svg')).toHaveCount(1, { timeout: 30_000 })
    await expect(iframe.locator('code.language-mermaid')).toHaveCount(0)
  })

  test('renders multiple Mermaid diagrams in one document', async ({ page }) => {
    const srcdoc = await buildSrcdoc(`
\`\`\`mermaid
flowchart TD
  A[One] --> B[Two]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant User
  participant Plugin
  User->>Plugin: second diagram
\`\`\`
`)

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.mdx-error')).toHaveCount(0, { timeout: 30_000 })
    await expect(iframe.locator('.mdx-mermaid svg')).toHaveCount(2, { timeout: 30_000 })
  })

  test('shows Mermaid errors without blanking the MDX preview', async ({ page }) => {
    const srcdoc = await buildSrcdoc(`
# Before

\`\`\`mermaid
flowchart TD
  A -->
\`\`\`

After the broken diagram.
`)

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.markdown-body h1')).toHaveText('Before', { timeout: 30_000 })
    await expect(iframe.locator('.mdx-mermaid-error')).toContainText('Mermaid Error')
    await expect(iframe.locator('.markdown-body')).toContainText('After the broken diagram.')
    await expect(iframe.locator('.mdx-error')).toHaveCount(0)
  })

  test('renders Mermaid diagrams alongside normal highlighted code', async ({ page }) => {
    const srcdoc = await buildSrcdoc(`
\`\`\`ts
const answer = 42
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant User
  participant Agent
  User->>Agent: render diagram
\`\`\`
`)

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.mdx-error')).toHaveCount(0, { timeout: 30_000 })
    await expect(iframe.locator('.mdx-mermaid svg')).toHaveCount(1)
    await expect(iframe.locator('pre')).toContainText('const answer = 42')
  })

  test('rewrites local image sources to provided Obsidian resource URLs', async ({ page }) => {
    const srcdoc = await buildSrcdoc(
      '![Dashboard](/images/the-reasoning-is-the-product/dashboard.png)',
      null,
      '',
      {
        '/images/the-reasoning-is-the-product/dashboard.png':
          'app://local/vault/public/images/the-reasoning-is-the-product/dashboard.png',
      },
    )

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.markdown-body img')).toHaveAttribute(
      'src',
      'app://local/vault/public/images/the-reasoning-is-the-product/dashboard.png',
      { timeout: 30_000 },
    )
    await expect(iframe.locator('.markdown-body img')).toHaveAttribute('alt', 'Dashboard')
  })

  test('rewrites and actually loads a spaced angle-bracket image source in the sandbox', async ({
    page,
  }) => {
    // 1x1 PNG. Proves two things at once: an angle-bracketed source with a space
    // (which the compiler percent-encodes to `my%20file.png`) is looked up via
    // its decoded key, and a rewritten src genuinely loads inside the
    // null-origin `allow-scripts` iframe rather than merely having its attribute
    // swapped.
    const pngDataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const srcdoc = await buildSrcdoc('![Photo](<my file.png>)', null, '', {
      'my file.png': pngDataUri,
    })

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const image = page.frameLocator('iframe').locator('.markdown-body img')
    await expect(image).toHaveAttribute('src', pngDataUri, { timeout: 30_000 })
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
        timeout: 30_000,
      })
      .toBe(true)
  })

  test('rewrites literal JSX <img> elements that bypass the components map', async ({ page }) => {
    // Written as JSX, `<img />` compiles to an intrinsic React element and never
    // reaches `components.img`, so the DOM sweep must catch it.
    const pngDataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const srcdoc = await buildSrcdoc('<img src="./logo.png" alt="Logo" />', null, '', {
      './logo.png': pngDataUri,
    })

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const image = page.frameLocator('iframe').locator('.markdown-body img')
    await expect(image).toHaveAttribute('src', pngDataUri, { timeout: 30_000 })
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
        timeout: 30_000,
      })
      .toBe(true)
  })

  test('returns an inert print snapshot from the sandboxed renderer', async ({ page }) => {
    const srcdoc = await buildSrcdoc(`
# Printable

<div dangerouslySetInnerHTML={{__html: '<a href="javascript:alert(1)">bad link</a><img src="javascript:alert(2)" onerror="window.__bad = 1"><script>window.__bad = 2</script><iframe src="https://example.com"></iframe>'}} />
`)

    await page.goto('about:blank')
    const html = await page.evaluate(
      (doc) =>
        new Promise<string>((resolve, reject) => {
          const iframe = document.createElement('iframe')
          const requestId = 42
          const timeout = window.setTimeout(() => reject(new Error('timed out waiting for snapshot')), 30_000)
          const onMessage = (event: MessageEvent) => {
            const data = event.data
            if (!data || data.__mdxPreview !== 'mdx-preview' || data.type !== 'print-snapshot') {
              return
            }
            if (data.requestId !== requestId) return
            window.clearTimeout(timeout)
            window.removeEventListener('message', onMessage)
            if (data.error) {
              reject(new Error(String(data.error)))
              return
            }
            resolve(String(data.html))
          }

          window.addEventListener('message', onMessage)
          iframe.addEventListener(
            'load',
            () => {
              iframe.contentWindow?.postMessage(
                { __mdxPreview: 'mdx-preview', type: 'print-snapshot-request', requestId },
                '*',
              )
            },
            { once: true },
          )
          iframe.setAttribute('sandbox', 'allow-scripts')
          iframe.srcdoc = doc
          document.body.appendChild(iframe)
        }),
      srcdoc,
    )

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Printable')
    expect(html).toContain('Embedded content omitted for print.')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('<iframe')
  })

  test('host print decorator sanitizes hostile snapshot HTML before writing', async ({ page }) => {
    await page.goto('about:blank')
    await page.addScriptTag({ content: printSnapshotScript })

    const html = await page.evaluate(() => {
      const api = (
        window as unknown as Window & {
          printSnapshot: { decoratePrintSnapshotHtml: (html: string, title: string) => string }
        }
      ).printSnapshot

      return api.decoratePrintSnapshotHtml(
        `<!DOCTYPE html>
<html>
<head><title>Wrong</title><script>window.__bad = 1</script></head>
<body>
  <base href="https://example.com/">
  <meta http-equiv="refresh" content="0; url=https://example.com">
  <a href="javascript:alert(1)" onclick="window.__bad = 2">bad link</a>
  <a href="vbscript:msgbox(1)">bad vbscript</a>
  <img src="javascript:alert(2)" onerror="window.__bad = 3">
  <img src="data:text/html,<script>alert(1)</script>">
  <img src="data:image/png;base64,iVBORw0KGgo=">
  <svg><a xlink:href="data:text/html,<script>alert(1)</script>">bad svg link</a></svg>
  <form action="javascript:alert(3)"><button formaction="data:text/html,bad">submit</button></form>
  <iframe src="https://example.com"></iframe>
  <object data="https://example.com"></object>
  <embed src="https://example.com">
</body>
</html>`,
        'Clean title',
      )
    })

    expect(html).toContain('<title>Clean title</title>')
    expect(html).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(html).toContain('Embedded content omitted for print.')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('window.__bad')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('vbscript:msgbox')
    expect(html).not.toContain('data:text/html')
    expect(html).not.toContain('<base')
    expect(html).not.toContain('http-equiv')
    expect(html).not.toContain('formaction')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<object')
    expect(html).not.toContain('<embed')
  })

  test('host sanitizes a malicious renderer snapshot response', async ({ page }) => {
    await page.goto('about:blank')
    await page.addScriptTag({ content: printSnapshotScript })

    const html = await page.evaluate(
      (maliciousHtml) =>
        new Promise<string>((resolve, reject) => {
          const api = (
            window as unknown as Window & {
              printSnapshot: { decoratePrintSnapshotHtml: (html: string, title: string) => string }
            }
          ).printSnapshot
          const iframe = document.createElement('iframe')
          const requestId = 7
          const timeout = window.setTimeout(() => reject(new Error('timed out waiting for response')), 30_000)
          const onMessage = (event: MessageEvent) => {
            const data = event.data
            if (!data || data.__mdxPreview !== 'mdx-preview' || data.type !== 'print-snapshot') {
              return
            }
            if (data.requestId !== requestId) return
            window.clearTimeout(timeout)
            window.removeEventListener('message', onMessage)
            resolve(api.decoratePrintSnapshotHtml(String(data.html), 'Host sanitized'))
          }

          window.addEventListener('message', onMessage)
          iframe.addEventListener(
            'load',
            () => {
              iframe.contentWindow?.postMessage(
                { __mdxPreview: 'mdx-preview', type: 'print-snapshot-request', requestId },
                '*',
              )
            },
            { once: true },
          )
          iframe.setAttribute('sandbox', 'allow-scripts')
          iframe.srcdoc = `<script>
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'print-snapshot-request') return
  window.parent.postMessage({
    __mdxPreview: 'mdx-preview',
    type: 'print-snapshot',
    requestId: event.data.requestId,
    html: ${JSON.stringify(maliciousHtml)}
  }, '*')
})
<\/script>`
          document.body.appendChild(iframe)
        }),
      '<!DOCTYPE html><html><body><img src=x onerror="window.__escaped = true"><a href="javascript:alert(1)">bad</a><iframe src="https://example.com"></iframe></body></html>',
    )

    expect(html).toContain('<title>Host sanitized</title>')
    expect(html).toContain('Embedded content omitted for print.')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('<iframe')
  })

  test('shows error message when __mdxRun is not defined', async ({ page }) => {
    const badSrcdoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body>
  <div id="root"></div>
  <script>${rendererScript}</script>
</body>
</html>`

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, badSrcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.mdx-error')).toContainText('MDX Error', { timeout: 30_000 })
  })

  test('renders unknown components as labeled placeholders', async ({ page }) => {
    const srcdoc = await buildSrcdoc(
      '<BuildLog date="2026-06-29" status="Shipped">\n\nEntry body text\n\n</BuildLog>',
    )

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.mdx-fallback-name')).toHaveText('BuildLog', { timeout: 30_000 })
    await expect(iframe.locator('.mdx-fallback-head')).toContainText('date: 2026-06-29')
    await expect(iframe.locator('.mdx-fallback-head')).toContainText('status: Shipped')
    await expect(iframe.locator('.mdx-fallback-body')).toContainText('Entry body text')
  })

  test('renders Code Hike scrollycoding steps with highlighted code', async ({ page }) => {
    const srcdoc = await buildSrcdoc(`
<Scrollycoding title="Demo walkthrough">

## !!steps First step

Introduce the first branch.

\`\`\`js !code app.js
function first() {
  return 1
}
\`\`\`

## !!steps Second step

Move to the second branch.

\`\`\`js !code app.js
function second() {
  return 2
}
\`\`\`

</Scrollycoding>
`)

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    await expect(iframe.locator('.mdx-scrollycoding-title')).toHaveText('Demo walkthrough', {
      timeout: 30_000,
    })
    await expect(iframe.locator('.mdx-scrollycoding-step')).toHaveCount(2)
    await expect(iframe.locator('.mdx-scrollycoding-step').first()).toContainText(
      'Introduce the first branch.',
    )
    await expect(iframe.locator('.mdx-scrollycoding-code pre')).toContainText('function first')
  })

  test('switches the sticky code panel to the step scrolled into view', async ({ page }) => {
    // The renderer tracks the active step with an IntersectionObserver and shows
    // that step's code in the sticky panel. Reproduce enough of the production
    // layout (tall steps + a grid) that scrolling moves a different step into the
    // observer's active band, then assert the active class and code both follow.
    const srcdoc = await buildSrcdoc(
      `
<Scrollycoding title="Demo walkthrough">

## !!steps First step

Introduce the first branch.

\`\`\`js !code app.js
function first() {
  return 1
}
\`\`\`

## !!steps Second step

Move to the second branch.

\`\`\`js !code app.js
function second() {
  return 2
}
\`\`\`

</Scrollycoding>
`,
      null,
      `.mdx-scrollycoding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
       .mdx-scrollycoding-steps { display: flex; flex-direction: column; gap: 18px; }
       .mdx-scrollycoding-step { min-height: 120vh; }
       .mdx-scrollycoding-code { position: sticky; top: 16px; }`,
    )

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      // A fixed desktop viewport so the two tall steps can't both sit in the
      // observer's active band at once.
      iframe.style.width = '900px'
      iframe.style.height = '600px'
      iframe.style.border = '0'
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    const steps = iframe.locator('.mdx-scrollycoding-step')
    const codePre = iframe.locator('.mdx-scrollycoding-code pre')

    // At the top, the first step is active and its code is in the panel.
    await expect(steps.nth(0)).toHaveClass(/mdx-scrollycoding-step-active/, { timeout: 30_000 })
    await expect(steps.nth(1)).not.toHaveClass(/mdx-scrollycoding-step-active/)
    await expect(codePre).toContainText('function first')

    // Scroll the second step into view; the active step and code must follow.
    const frame = page.frames().find((f) => f.parentFrame() === page.mainFrame())
    if (!frame) throw new Error('preview iframe not found')
    await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    await expect(steps.nth(1)).toHaveClass(/mdx-scrollycoding-step-active/)
    await expect(steps.nth(0)).not.toHaveClass(/mdx-scrollycoding-step-active/)
    await expect(codePre).toContainText('function second')
  })

  test('renders a step with multiple code files without blanking the preview', async ({ page }) => {
    // Code Hike's multi-value marker (!!code) makes step.code an array of
    // highlighted blocks. Passing that array straight to Pre throws on the
    // missing `tokens`; the step must render every block instead.
    const srcdoc = await buildSrcdoc(`
<Scrollycoding title="Multi-file step">

## !!steps Both files

Show two files at once.

\`\`\`js !!code
const alpha = 1
\`\`\`

\`\`\`js !!code
const beta = 2
\`\`\`

</Scrollycoding>
`)

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    // The preview renders (no MDX Error) and both code blocks are present.
    await expect(iframe.locator('.mdx-scrollycoding-title')).toHaveText('Multi-file step', {
      timeout: 30_000,
    })
    await expect(iframe.locator('.mdx-error')).toHaveCount(0)
    const codeBlocks = iframe.locator('.mdx-scrollycoding-code pre')
    await expect(codeBlocks).toHaveCount(2)
    await expect(codeBlocks.nth(0)).toContainText('const alpha')
    await expect(codeBlocks.nth(1)).toContainText('const beta')
  })

  test('renders frontmatter as a properties table above the body', async ({ page }) => {
    const srcdoc = await buildSrcdoc('# Visible Heading\n', {
      title: 'About',
      jobTitle: 'Builder',
      knowsAbout: ['AI Engineering', 'Personal Finance'],
    })

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    // Frontmatter keys render as table header cells.
    await expect(iframe.locator('table.mdx-frontmatter th').first()).toHaveText('title', {
      timeout: 30_000,
    })
    // Array values are comma-joined in a single cell.
    await expect(iframe.locator('table.mdx-frontmatter')).toContainText(
      'AI Engineering, Personal Finance',
    )
    // The body still renders below the table.
    await expect(iframe.locator('h1')).toHaveText('Visible Heading')
  })

  test('handles a </script> value in frontmatter without breaking out', async ({ page }) => {
    const srcdoc = await buildSrcdoc('# Heading\n', { title: '</script><img>', ok: 'yes' })

    await page.goto('about:blank')
    await page.evaluate((doc) => {
      const iframe = document.createElement('iframe')
      iframe.setAttribute('sandbox', 'allow-scripts')
      iframe.srcdoc = doc
      document.body.appendChild(iframe)
    }, srcdoc)

    const iframe = page.frameLocator('iframe')
    // Table still renders (script tag was not terminated early)…
    await expect(iframe.locator('table.mdx-frontmatter')).toContainText('</script><img>', {
      timeout: 30_000,
    })
    // …and the body below it renders too.
    await expect(iframe.locator('.markdown-body h1')).toHaveText('Heading')
  })

  test('escapes </script in compiled output', async () => {
    const mdx = 'This contains `</script>` in inline code.'
    const compiled = await compile(mdx, {
      outputFormat: 'function-body',
      remarkPlugins: [[remarkCodeHike, chConfig]],
      recmaPlugins: [[recmaCodeHike, chConfig]],
      development: false,
    })

    const raw = String(compiled)
    // The raw compiled output must contain </script (proving it needs escaping)
    expect(raw).toContain('</script')

    const escaped = raw.replace(/<\/script/gi, '<\\/script')
    // After escaping, no unescaped </script should remain
    expect(escaped).not.toContain('</script')
  })
})
