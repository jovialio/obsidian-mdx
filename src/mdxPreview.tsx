import { TextFileView, WorkspaceLeaf, parseYaml, setIcon } from 'obsidian'
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
  private editorEl: HTMLTextAreaElement | null = null
  private toggleAction: HTMLElement | null = null
  private _mode: 'preview' | 'source' = 'preview'
  private _content = ''
  private _renderTimer: number | null = null
  private _renderGeneration = 0

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  async onOpen() {
    // Top-right action to switch between the rendered preview and an editable
    // source view, mirroring Obsidian's native read/edit toggle.
    if (!this.toggleAction) {
      this.toggleAction = this.addAction('pencil', 'Edit source', () => this.toggleMode())
      this.updateToggleIcon()
    }
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
    if (this._renderTimer) window.clearTimeout(this._renderTimer)
    this._renderTimer = window.setTimeout(() => this.render(), clear ? 0 : 400)
  }

  clear(): void {
    this._content = ''
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
    this.editorEl = null
  }

  private toggleMode(): void {
    this._mode = this._mode === 'preview' ? 'source' : 'preview'
    // Cancel any in-flight preview compile so it can't draw over the editor.
    this._renderGeneration++
    this.updateToggleIcon()
    this.render()
  }

  private updateToggleIcon(): void {
    if (!this.toggleAction) return
    const inPreview = this._mode === 'preview'
    // In preview show a pencil (click to edit); in source show a book (click to read).
    setIcon(this.toggleAction, inPreview ? 'pencil' : 'book-open')
    this.toggleAction.setAttribute('aria-label', inPreview ? 'Edit source' : 'Preview')
  }

  private renderSource(): void {
    const container = this.containerEl.children[1] as HTMLElement
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
    // Reuse the textarea if it already shows the current content, so typing
    // never rebuilds the element and loses focus/cursor position.
    if (this.editorEl && this.editorEl.value === this._content) return
    container.empty()
    // The editor fills the view via position: absolute, so its container must
    // establish a positioning context.
    container.style.position = 'relative'
    const editor = container.createEl('textarea', { cls: 'mdx-source' })
    editor.value = this._content
    editor.spellcheck = false
    editor.addEventListener('input', () => {
      this._content = editor.value
      this.requestSave()
    })
    this.editorEl = editor
    editor.focus()
  }

  render(): void {
    if (this._mode === 'source') {
      this.renderSource()
      return
    }
    void this.renderPreview()
  }

  private showConsentBanner(): void {
    const container = this.containerEl.children[1] as HTMLElement
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
    this.editorEl = null
    container.empty()

    const banner = container.createDiv({ cls: 'mdx-consent' })
    banner.createEl('strong', { text: 'MDX executes JavaScript' })
    banner.createEl('p', {
      text: 'Scripts run in a sandboxed iframe with no access to your vault or Obsidian APIs. However, they can make outbound network requests. Only preview files you trust.',
    })
    const btn = banner.createEl('button', { text: 'Enable MDX Preview' })
    btn.addEventListener('click', () => {
      consentGiven = true
      banner.remove()
      void this.render()
    })
  }

  private async renderPreview() {
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

    // MDX has no built-in frontmatter support, so a leading --- ... --- block
    // would otherwise render as literal text. Pull it out and parse it so the
    // renderer can show it as a properties table (like Obsidian's reading
    // view), then compile only the body below it.
    const fmMatch = this._content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
    let frontmatter: Record<string, unknown> | null = null
    if (fmMatch) {
      try {
        const parsed: unknown = parseYaml(fmMatch[1])
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          frontmatter = parsed as Record<string, unknown>
        }
      } catch {
        // Invalid YAML — skip the table rather than failing the whole preview.
      }
    }
    const source = fmMatch ? this._content.slice(fmMatch[0].length) : this._content

    let compiledBody: string
    try {
      const compiled = await compile(source, {
        outputFormat: 'function-body',
        remarkPlugins: [[remarkCodeHike, chConfig]],
        recmaPlugins: [[recmaCodeHike, chConfig]],
        development: false,
      })
      compiledBody = String(compiled).replace(/<\/script/gi, '<\\/script')
    } catch (err) {
      compiledBody = `throw new Error(${JSON.stringify(String(err))})`.replace(/<\/script/gi, '<\\/script')
    }

    // A newer render started, or the user switched to source mode, while we
    // were compiling — discard this result so it can't draw over the editor.
    if (generation !== this._renderGeneration || this._mode !== 'preview') return

    // Components the MDX references but that we can't provide (custom components
    // from the author's own app) would throw "Expected component X to be
    // defined". Collect those names so the renderer can substitute a readable
    // placeholder instead of failing the whole preview.
    const fallbackNames = [
      ...new Set(
        [...compiledBody.matchAll(/_missingMdxReference\(\s*["']([A-Za-z_$][\w$]*)["']/g)].map(
          (m) => m[1],
        ),
      ),
    ]

    // Compiled MDX is embedded as a regular function definition so the renderer
    // can call it directly — no eval() or new Function() required.
    //
    // The iframe has a null origin (sandbox with no allow-same-origin), so it
    // cannot inherit Obsidian's CSS variables. Read the current theme's colors
    // from the host document and inject them as concrete values so the preview
    // matches light/dark mode instead of defaulting to a white page.
    const hostStyle = activeWindow.getComputedStyle(this.containerEl)
    const cssValue = (name: string, fallback: string): string => {
      const raw = hostStyle.getPropertyValue(name).trim()
      // Strip characters that could break out of the CSS/HTML context.
      const safe = raw.replace(/[<>{};]/g, '')
      return safe || fallback
    }
    const bg = cssValue('--background-primary', '#ffffff')
    const fg = cssValue('--text-normal', '#1e1e1e')
    const font = cssValue('--font-text', 'sans-serif')
    const accent = cssValue('--text-accent', '#7b6cd9')
    const border = cssValue('--background-modifier-border', '#d0d0d0')
    const muted = cssValue('--text-muted', '#8a8a8a')
    const codeBg = cssValue('--background-secondary', '#f2f2f2')

    // GitHub-style reading layout: a constrained, centered column with generous
    // spacing and clear heading/table/quote styling, all derived from the active
    // Obsidian theme. Typography is scoped to .markdown-body so it never touches
    // Code Hike code blocks or the frontmatter table above the content.
    const srcdoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0 auto; max-width: 820px; padding: 24px 24px 64px; background: ${bg}; color: ${fg}; font-family: ${font}; font-size: 16px; line-height: 1.6; word-wrap: break-word; }
    a { color: ${accent}; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .markdown-body > :first-child { margin-top: 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
    .markdown-body h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid ${border}; }
    .markdown-body h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid ${border}; }
    .markdown-body h3 { font-size: 1.25em; }
    .markdown-body p { margin: 0 0 16px; }
    .markdown-body ul, .markdown-body ol { margin: 0 0 16px; padding-left: 2em; }
    .markdown-body li + li { margin-top: .25em; }
    .markdown-body blockquote { margin: 0 0 16px; padding: 0 1em; color: ${muted}; border-left: .25em solid ${border}; }
    .markdown-body hr { height: .25em; border: 0; background: ${border}; margin: 24px 0; }
    .markdown-body img { max-width: 100%; }
    .markdown-body table { border-collapse: collapse; margin: 0 0 16px; display: block; width: max-content; max-width: 100%; overflow: auto; }
    .markdown-body th, .markdown-body td { border: 1px solid ${border}; padding: 6px 13px; }
    .markdown-body tr:nth-child(2n) { background: ${codeBg}; }
    .markdown-body :not(pre) > code { padding: .2em .4em; font-size: 85%; background: ${codeBg}; border-radius: 6px; }
    .markdown-body pre { margin: 0 0 16px; border-radius: 6px; overflow: auto; }
    .mdx-error { color: #ff5555; white-space: pre-wrap; font-family: monospace; }
    .mdx-fallback { border: 1px solid ${accent}; border-radius: 6px; padding: 8px 12px; margin: 12px 0; }
    .mdx-fallback-head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; margin-bottom: 6px; font-size: 0.8em; }
    .mdx-fallback-name { font-weight: 600; color: ${accent}; font-family: monospace; }
    .mdx-fallback-attr { opacity: 0.7; }
    .mdx-fallback-body > :first-child { margin-top: 0; }
    .mdx-frontmatter { border-collapse: collapse; width: 100%; margin: 0 0 24px; font-size: 0.9em; }
    .mdx-frontmatter th, .mdx-frontmatter td { border: 1px solid ${border}; padding: 4px 10px; text-align: left; vertical-align: top; }
    .mdx-frontmatter th { width: 30%; font-weight: 600; opacity: 0.75; white-space: nowrap; }
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

    const container = this.containerEl.children[1] as HTMLElement
    container.empty()
    this.editorEl = null

    const iframe = activeDocument.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.srcdoc = srcdoc
    iframe.addClass('mdx-preview-iframe')
    this.iframe = iframe
    container.appendChild(iframe)
  }

  async onClose() {
    if (this._renderTimer) window.clearTimeout(this._renderTimer)
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
    this.editorEl = null
  }
}
