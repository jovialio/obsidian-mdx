import { ItemView, ViewStateResult } from 'obsidian'
import { compile } from '@mdx-js/mdx'
import { remarkCodeHike } from '@code-hike/mdx'
import theme from 'shiki/themes/github-dark.json'

export const MDX_PREVIEW = 'mdx-preview'

export type MDXPreviewState = {
  data: string
  basename: string
}

export class mdxPreview extends ItemView {
  private iframe: HTMLIFrameElement | null = null
  state: MDXPreviewState = {
    data: '',
    basename: '',
  }

  setState(state: MDXPreviewState, _result: ViewStateResult): Promise<void> {
    this.state = state
    return this.render()
  }

  getState() {
    return this.state
  }

  clear(): void {}

  getDisplayText(): string {
    return 'MDX Preview'
  }

  getViewType(): string {
    return MDX_PREVIEW
  }

  async render() {
    const fileContent = this.state.data

    // Compile MDX to a function-body string in the plugin process — no code runs here
    const compiled = await compile(fileContent, {
      outputFormat: 'function-body',
      remarkPlugins: [
        [
          remarkCodeHike,
          {
            theme,
            autoImport: false,
          },
        ],
      ],
      development: false,
    })

    // JSON-encode the compiled body and escape </script to prevent the HTML parser
    // from closing the <script type="application/json"> data block prematurely.
    // JSON's \/ decodes to / so the payload is still valid when parsed in the iframe.
    const compiledJson = JSON.stringify(String(compiled)).replace(
      /<\/script/gi,
      '<\\/script'
    )

    // The iframe is sandboxed with allow-scripts only — no allow-same-origin —
    // so it has a null origin and cannot reach the parent window, the vault,
    // or any Node.js / Electron API. React and Code Hike are loaded from CDN
    // because the sandboxed context cannot access the plugin's bundled modules.
    const srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18.2.0",
      "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime",
      "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
      "@code-hike/mdx/components": "https://esm.sh/@code-hike/mdx@0.8.3/components"
    }
  }
  </script>
  <script id="mdx-compiled" type="application/json">${compiledJson}</script>
  <style>
    body { margin: 0; padding: 16px; font-family: var(--font-text, sans-serif); }
    .mdx-error { color: red; white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import * as runtime from 'react/jsx-runtime'
    import ReactDOM from 'react-dom/client'
    import { CH } from '@code-hike/mdx/components'

    try {
      const body = JSON.parse(document.getElementById('mdx-compiled').textContent)
      const fn = new Function(body)
      const { default: MDXContent } = fn({ ...runtime })
      const root = ReactDOM.createRoot(document.getElementById('root'))
      root.render(MDXContent({ components: { CH } }))
    } catch (err) {
      document.getElementById('root').innerHTML =
        '<pre class="mdx-error">MDX Error: ' + String(err) + '</pre>'
    }
  </script>
</body>
</html>`

    const container = this.containerEl.children[1] as HTMLElement

    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }

    this.iframe = document.createElement('iframe')
    this.iframe.setAttribute('sandbox', 'allow-scripts')
    this.iframe.srcdoc = srcdoc
    this.iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;'

    container.appendChild(this.iframe)
  }

  async onClose() {
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
  }
}
