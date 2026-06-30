import { test, expect } from '@playwright/test'
import { compile } from '@mdx-js/mdx'
import { remarkCodeHike, recmaCodeHike } from 'codehike/mdx'
import esbuild from 'esbuild'

let rendererScript = ''

const chConfig = {
  components: { code: 'Code' },
  syntaxHighlighting: { theme: 'github-dark' },
}

test.beforeAll(async () => {
  const result = await esbuild.build({
    entryPoints: ['src/renderer.tsx'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    treeShaking: true,
  })
  rendererScript = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
})

async function buildSrcdoc(mdx: string): Promise<string> {
  const compiled = await compile(mdx, {
    outputFormat: 'function-body',
    remarkPlugins: [[remarkCodeHike, chConfig]],
    recmaPlugins: [[recmaCodeHike, chConfig]],
    development: false,
  })

  const compiledJson = JSON.stringify(String(compiled)).replace(
    /<\/script/gi,
    '<\\/script'
  )

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 16px; }
    .mdx-error { color: red; white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script id="mdx-compiled" type="application/json">${compiledJson}</script>
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
    await expect(iframe.locator('h1')).toHaveText('Hello', { timeout: 30_000 })
    await expect(iframe.locator('strong')).toHaveText('MDX')
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

  test('shows error message when renderer receives invalid data', async ({ page }) => {
    const badSrcdoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body>
  <div id="root"></div>
  <script id="mdx-compiled" type="application/json">NOT_VALID_JSON</script>
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

  test('escapes </script in compiled output', async () => {
    const mdx = 'This contains `</script>` in inline code.'
    const compiled = await compile(mdx, {
      outputFormat: 'function-body',
      remarkPlugins: [[remarkCodeHike, chConfig]],
      recmaPlugins: [[recmaCodeHike, chConfig]],
      development: false,
    })

    const raw = JSON.stringify(String(compiled))
    // The raw JSON must contain </script (proving it needs escaping)
    expect(raw).toContain('</script')

    const escaped = raw.replace(/<\/script/gi, '<\\/script')
    // After escaping, no unescaped </script should remain
    expect(escaped).not.toContain('</script')
  })
})
