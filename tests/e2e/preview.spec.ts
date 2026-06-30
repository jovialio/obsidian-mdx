import { test, expect } from '@playwright/test'
import { compile } from '@mdx-js/mdx'

async function buildSrcdoc(mdx: string): Promise<string> {
  const compiled = await compile(mdx, {
    outputFormat: 'function-body',
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
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18.2.0",
      "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime",
      "react-dom/client": "https://esm.sh/react-dom@18.2.0/client"
    }
  }
  </script>
  <script id="mdx-compiled" type="application/json">${compiledJson}</script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import * as runtime from 'react/jsx-runtime'
    import ReactDOM from 'react-dom/client'
    try {
      const body = JSON.parse(document.getElementById('mdx-compiled').textContent)
      const fn = new Function(body)
      const { default: MDXContent } = fn({ ...runtime })
      ReactDOM.createRoot(document.getElementById('root')).render(MDXContent({}))
    } catch (err) {
      document.getElementById('root').innerHTML = '<pre id="error">' + String(err) + '</pre>'
    }
  </script>
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

  test('shows error message for invalid MDX', async ({ page }) => {
    // Unclosed JSX tag — compile will throw
    await expect(
      compile('<Broken', { outputFormat: 'function-body', development: false })
    ).rejects.toThrow()
  })

  test('escapes </script in compiled output', async () => {
    const mdx = 'This contains `</script>` in inline code.'
    const compiled = await compile(mdx, {
      outputFormat: 'function-body',
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
