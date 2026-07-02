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

async function buildSrcdoc(
  mdx: string,
  frontmatter: Record<string, unknown> | null = null,
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
  <script>window.__mdxFrontmatter = ${JSON.stringify(frontmatter).replace(/<\/script/gi, '<\\/script')}</script>
  <script>window.__mdxFallbacks = ${JSON.stringify(fallbackNames).replace(/<\/script/gi, '<\\/script')}</script>
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
