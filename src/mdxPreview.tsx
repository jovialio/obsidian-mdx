import { TextFileView, WorkspaceLeaf } from 'obsidian'
import { compile } from '@mdx-js/mdx'
import { remarkCodeHike, recmaCodeHike } from 'codehike/mdx'
import rendererScript from 'renderer-script'

export const MDX_PREVIEW = 'mdx-preview'

// Session-scoped — resets on each Obsidian restart / plugin reload.
// Requires the user to explicitly enable rendering once per session before
// any MDX JavaScript runs, since allow-scripts lets iframe code make
// outbound requests even though vault/parent APIs are blocked.
let consentGiven = false

export class mdxPreview extends TextFileView {
  private iframe: HTMLIFrameElement | null = null
  private _content = ''
  private _renderTimer: ReturnType<typeof setTimeout> | null = null
  private _renderGeneration = 0

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType(): string {
    return MDX_PREVIEW
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'MDX Preview'
  }

  getViewData(): string {
    return this._content
  }

  setViewData(data: string, clear: boolean): void {
    this._content = data
    if (this._renderTimer) clearTimeout(this._renderTimer)
    this._renderTimer = setTimeout(() => this.render(), clear ? 0 : 400)
  }

  clear(): void {
    this._content = ''
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
  }

  private showConsentBanner(): void {
    const container = this.containerEl.children[1] as HTMLElement
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
    container.empty()

    const banner = container.createDiv({ cls: 'mdx-consent' })
    banner.style.cssText = 'padding:24px;max-width:480px;'
    banner.createEl('strong', { text: 'MDX executes JavaScript' })
    banner.createEl('p', {
      text: 'Scripts run in a sandboxed iframe with no access to your vault or Obsidian APIs. However, they can make outbound network requests. Only preview files you trust.',
    })
    const btn = banner.createEl('button', { text: 'Enable MDX Preview' })
    btn.style.cssText = 'margin-top:8px;'
    btn.addEventListener('click', () => {
      consentGiven = true
      banner.remove()
      this.render()
    })
  }

  async render() {
    if (!consentGiven) {
      this.showConsentBanner()
      return
    }

    // Increment generation so any in-flight compile from a previous call
    // can detect it has been superseded and skip the DOM update.
    const generation = ++this._renderGeneration

    const chConfig = {
      components: { code: 'Code' },
      syntaxHighlighting: { theme: 'github-dark' },
    }

    let compiledJson: string
    try {
      const compiled = await compile(this._content, {
        outputFormat: 'function-body',
        remarkPlugins: [[remarkCodeHike, chConfig]],
        recmaPlugins: [[recmaCodeHike, chConfig]],
        development: false,
      })
      compiledJson = JSON.stringify(String(compiled)).replace(/<\/script/gi, '<\\/script')
    } catch (err) {
      compiledJson = JSON.stringify(
        `throw new Error(${JSON.stringify(String(err))})`
      ).replace(/<\/script/gi, '<\\/script')
    }

    // A newer render started while we were compiling — discard this result.
    if (generation !== this._renderGeneration) return

    const srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 16px; font-family: var(--font-text, sans-serif); }
    .mdx-error { color: red; white-space: pre-wrap; font-family: monospace; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script id="mdx-compiled" type="application/json">${compiledJson}</script>
  <script>${rendererScript}</script>
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
    if (this._renderTimer) clearTimeout(this._renderTimer)
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
  }
}
