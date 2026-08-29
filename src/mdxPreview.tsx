import { Notice, TextFileView, TFile, WorkspaceLeaf, normalizePath, parseYaml, setIcon } from 'obsidian'
import { compile } from '@mdx-js/mdx'
import { remarkCodeHike, recmaCodeHike } from 'codehike/mdx'
import type { CodeHikeConfig } from 'codehike/mdx'
import mermaidRendererScript from 'mermaid-renderer-script'
import rendererScript from 'renderer-script'
import {
  appendDataUrlFragment,
  appendResourceSuffix,
  arrayBufferToDataUrl,
  decodeImageSource,
  extractImageSources,
  imageCandidatePaths,
  imageMimeTypeForPath,
  imageSourceSuffix,
  isExternalImageSource,
} from './imageSources'
import { decoratePrintSnapshotHtml, escapeHtml, printMessageMarker } from './printSnapshot'

export const MDX_PREVIEW = 'mdx-preview'

// Session-scoped — resets on each Obsidian restart / plugin reload.
// Requires the user to explicitly enable rendering once per session before
// any MDX JavaScript runs, since allow-scripts lets iframe code make
// outbound requests even though vault/parent APIs are blocked.
let consentGiven = false

const chConfig: CodeHikeConfig = {
  components: { code: 'Code' },
  syntaxHighlighting: { theme: 'github-dark' },
  // Mermaid has its own syntax and no Code Hike grammar in this renderer. Leave
  // it as a normal Markdown fence so previewing a post with diagrams does not
  // blank the whole MDX document.
  ignoreCode: (codeblock) => codeblock.lang === 'mermaid',
}

type PendingPrintSnapshot = {
  requestId: number
  printWindow: Window
  resendTimer: number
  timeoutTimer: number
}

type PrintSnapshotResponse = {
  __mdxPreview: typeof printMessageMarker
  type: 'print-snapshot'
  requestId: number
  html?: unknown
  error?: unknown
}

const printReadyTimeoutMs = 2500
const printWindowLoadTimeoutMs = 1500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPrintSnapshotResponse(value: unknown): value is PrintSnapshotResponse {
  return (
    isRecord(value) &&
    value.__mdxPreview === printMessageMarker &&
    value.type === 'print-snapshot' &&
    typeof value.requestId === 'number'
  )
}

export class mdxPreview extends TextFileView {
  private iframe: HTMLIFrameElement | null = null
  private editorEl: HTMLTextAreaElement | null = null
  private toggleAction: HTMLElement | null = null
  private printAction: HTMLElement | null = null
  private _mode: 'preview' | 'source' = 'preview'
  private _content = ''
  private _renderTimer: number | null = null
  private _renderGeneration = 0
  private _printRequestId = 0
  private _pendingPrintSnapshot: PendingPrintSnapshot | null = null
  private _messageBound = false
  // Cache encoded data URLs by vault path so debounced re-renders don't re-read
  // and re-encode unchanged images; keyed with mtime so edits are picked up.
  private _dataUrlCache = new Map<string, { mtime: number; url: string }>()

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
    if (!this.printAction) {
      this.printAction = this.addAction('printer', 'Print / Save as PDF', () => this.printCurrentMdx())
    }
    if (!this._messageBound) {
      this._messageBound = true
      this.registerDomEvent(activeWindow, 'message', (event: MessageEvent) => {
        this.handleRendererMessage(event)
      })
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
    this._dataUrlCache.clear()
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

  private cancelScheduledRender(): void {
    if (!this._renderTimer) return
    window.clearTimeout(this._renderTimer)
    this._renderTimer = null
  }

  // Each call opens a fresh blob URL and installs its own `load` listener + fallback
  // timer, so a later call (snapshot) safely supersedes an earlier one (status page)
  // without the two racing to resolve the same navigation.
  private loadPrintWindowHtml(printWindow: Window, html: string): Promise<void> {
    const url = window.URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        printWindow.removeEventListener('load', finish)
        window.clearTimeout(timeoutTimer)
        window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
        resolve()
      }
      const timeoutTimer = window.setTimeout(finish, printWindowLoadTimeoutMs)
      printWindow.addEventListener('load', finish, { once: true })
      printWindow.location.href = url
    })
  }

  private showPrintStatusPage(printWindow: Window, title: string, message: string): void {
    void this.loadPrintWindowHtml(
      printWindow,
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 24px; font-family: sans-serif; color: #1e1e1e; background: #ffffff; }
  </style>
</head>
<body>${escapeHtml(message)}</body>
</html>`,
    )
  }

  private waitForPrintWindow(printWindow: Window): Promise<void> {
    const doc = printWindow.document
    const imageReady = Promise.all(
      Array.from(doc.images).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve()
              return
            }
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          }),
      ),
    )
      .then(() => undefined)
      .catch(() => undefined)
    const fonts = (doc as Document & { fonts?: { ready?: Promise<unknown> } }).fonts
    const fontsReady = fonts?.ready
      ? fonts.ready.then(() => undefined).catch(() => undefined)
      : Promise.resolve()

    return Promise.race([
      Promise.all([imageReady, fontsReady]).then(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, printReadyTimeoutMs)),
    ])
  }

  private async printPreparedWindow(printWindow: Window): Promise<void> {
    await this.waitForPrintWindow(printWindow)
    if (printWindow.closed) return

    printWindow.addEventListener('afterprint', () => window.setTimeout(() => printWindow.close(), 100), {
      once: true,
    })
    printWindow.focus()
    printWindow.print()
  }

  private requestPrintSnapshot(printWindow: Window): void {
    const iframeWindow = this.iframe?.contentWindow
    if (!iframeWindow) throw new Error('Preview iframe is not ready')

    if (this._pendingPrintSnapshot) {
      window.clearInterval(this._pendingPrintSnapshot.resendTimer)
      window.clearTimeout(this._pendingPrintSnapshot.timeoutTimer)
      this.showPrintStatusPage(
        this._pendingPrintSnapshot.printWindow,
        'MDX Preview',
        'A newer print request replaced this one.',
      )
      this._pendingPrintSnapshot = null
    }

    const requestId = ++this._printRequestId
    const message = { __mdxPreview: printMessageMarker, type: 'print-snapshot-request', requestId }
    const send = () => iframeWindow.postMessage(message, '*')
    const resendTimer = window.setInterval(send, 100)
    const timeoutTimer = window.setTimeout(() => {
      window.clearInterval(resendTimer)
      if (this._pendingPrintSnapshot?.requestId === requestId) {
        this._pendingPrintSnapshot = null
      }
      this.showPrintStatusPage(printWindow, 'MDX Preview', 'The MDX preview was not ready to print.')
      new Notice('MDX Preview: preview was not ready to print.', 5000)
    }, 6000)

    this._pendingPrintSnapshot = { requestId, printWindow, resendTimer, timeoutTimer }
    send()
  }

  private handleRendererMessage(event: MessageEvent): void {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return

    const data: unknown = event.data
    if (!isPrintSnapshotResponse(data)) return

    const pending = this._pendingPrintSnapshot
    if (!pending || data.requestId !== pending.requestId) return

    window.clearInterval(pending.resendTimer)
    window.clearTimeout(pending.timeoutTimer)
    this._pendingPrintSnapshot = null

    if (data.error) {
      this.showPrintStatusPage(pending.printWindow, 'MDX Preview', `Unable to prepare print view: ${String(data.error)}`)
      new Notice('MDX Preview: unable to prepare print view.', 5000)
      return
    }

    void this.loadPrintWindowHtml(
      pending.printWindow,
      decoratePrintSnapshotHtml(String(data.html), this.file?.basename ?? 'MDX Preview'),
    )
      .then(() => this.printPreparedWindow(pending.printWindow))
      .catch(() => {
        new Notice('MDX Preview: unable to open print dialog.', 5000)
      })
  }

  private async printCurrentMdx(): Promise<void> {
    if (!consentGiven) {
      this.showConsentBanner()
      new Notice('Enable MDX Preview before printing.', 5000)
      return
    }

    if (this._pendingPrintSnapshot) {
      this._pendingPrintSnapshot.printWindow.focus()
      new Notice('MDX Preview: print view is already being prepared.', 3000)
      return
    }

    // Intentional split: window/event/geometry calls target `activeWindow` (so printing
    // keeps working when the view lives in a popout window), while timers and blob URLs
    // use `window`. Keep them separate — unifying these would break popout-window printing.
    const printWindow = activeWindow.open('', '_blank')
    if (!printWindow) {
      new Notice('MDX Preview: allow popups to print or save as PDF.', 5000)
      return
    }
    printWindow.opener = null
    this.showPrintStatusPage(printWindow, this.file?.basename ?? 'MDX Preview', 'Preparing print view...')

    if (this._mode === 'source') {
      this._mode = 'preview'
      this.updateToggleIcon()
    }

    try {
      this.cancelScheduledRender()
      const rendered = await this.renderPreview()
      if (!rendered) throw new Error('Preview iframe is not ready')
      this.requestPrintSnapshot(printWindow)
    } catch (err) {
      this.showPrintStatusPage(printWindow, 'MDX Preview', `Unable to prepare print view: ${String(err)}`)
      new Notice('MDX Preview: unable to prepare print view.', 5000)
    }
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
    // establish a positioning context (see .mdx-editing in styles.css).
    container.addClass('mdx-editing')
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
    container.removeClass('mdx-editing')
    container.empty()

    const banner = container.createDiv({ cls: 'mdx-consent' })
    banner.createEl('strong', { text: 'MDX executes JavaScript' })
    banner.createEl('p', {
      text: 'Scripts run in a sandboxed iframe with no access to Obsidian APIs or arbitrary vault files. However, they can make outbound network requests, and any vault image this file references is embedded so its scripts can read it. Only preview files you trust.',
    })
    const btn = banner.createEl('button', { text: 'Enable MDX Preview' })
    btn.addEventListener('click', () => {
      consentGiven = true
      banner.remove()
      void this.render()
    })
  }

  private async collectImageSources(source: string): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {}
    // Key by the decoded source so the map matches whatever the compiled MDX
    // emits: angle-bracketed links with spaces (`![a](<my file.png>)`) come out
    // percent-encoded, while inline links keep the author's spelling. Decoding
    // both sides (here and in the renderer) makes the lookup agree either way.
    const seen = new Set<string>()

    for (const src of extractImageSources(source)) {
      const key = decodeImageSource(src)
      if (seen.has(key)) continue
      seen.add(key)
      const resourcePath = await this.resolveImageSource(src)
      if (resourcePath) resolved[key] = resourcePath
    }

    return resolved
  }

  private async resolveImageSource(src: string): Promise<string | null> {
    if (isExternalImageSource(src)) return null

    const fileDir = this.file?.parent?.path
    const baseDir = fileDir && fileDir !== '/' ? fileDir : ''

    for (const candidate of imageCandidatePaths(src, baseDir)) {
      const normalized = normalizePath(candidate)
      const file = this.app.vault.getAbstractFileByPath(normalized)
      if (file instanceof TFile) {
        // The preview runs in a sandboxed, null-origin iframe. Both `app://`
        // resource URLs and host-created `blob:` object URLs are scoped to
        // Obsidian's origin, so neither loads inside that iframe. An inline
        // data URL carries no origin and always renders. Fall back to the
        // resource URL only for MIME types we can't name (which would produce a
        // non-renderable data URL) or if the vault bytes can't be read.
        const { query, fragment } = imageSourceSuffix(src)
        const resourceUrl = () => appendResourceSuffix(this.app.vault.getResourcePath(file), query, fragment)
        const mimeType = imageMimeTypeForPath(file.path)
        if (mimeType === 'application/octet-stream') return resourceUrl()

        try {
          const dataUrl = await this.dataUrlForImage(file, mimeType)
          return appendDataUrlFragment(dataUrl, fragment)
        } catch {
          return resourceUrl()
        }
      }
    }

    return null
  }

  private async dataUrlForImage(file: TFile, mimeType: string): Promise<string> {
    const cached = this._dataUrlCache.get(file.path)
    if (cached && cached.mtime === file.stat.mtime) return cached.url

    // Encoding is skipped on cache hits so debounced re-renders of an unchanged
    // note don't re-read the file bytes or re-run base64.
    const buffer = await this.app.vault.readBinary(file)
    const url = arrayBufferToDataUrl(buffer, mimeType)
    this._dataUrlCache.set(file.path, { mtime: file.stat.mtime, url })
    return url
  }

  private async renderPreview(): Promise<boolean> {
    if (!consentGiven) {
      this.showConsentBanner()
      return false
    }

    // Increment generation so any in-flight compile from a previous call
    // can detect it has been superseded and skip the DOM update.
    const generation = ++this._renderGeneration

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
    const imageSources = await this.collectImageSources(source)

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
    if (generation !== this._renderGeneration || this._mode !== 'preview') return false

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
    const hasMermaid = /\blanguage-mermaid\b/.test(compiledBody)

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
    const mermaidTheme = {
      background: bg,
      mainBkg: codeBg,
      primaryColor: codeBg,
      primaryTextColor: fg,
      primaryBorderColor: border,
      secondaryColor: bg,
      tertiaryColor: codeBg,
      textColor: fg,
      lineColor: muted,
      nodeBorder: border,
      clusterBkg: bg,
      clusterBorder: border,
      edgeLabelBackground: bg,
      fontFamily: font,
    }

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
    .mdx-mermaid { margin: 0 0 16px; overflow: auto; text-align: center; }
    .mdx-mermaid[aria-busy="true"] { min-height: 80px; }
    .mdx-mermaid svg { max-width: 100%; height: auto; }
    .mdx-mermaid-error { margin: 0 0 16px; padding: 12px; border: 1px solid #ff5555; border-radius: 6px; color: #ff5555; background: ${codeBg}; white-space: pre-wrap; }
    .mdx-error { color: #ff5555; white-space: pre-wrap; font-family: monospace; }
    .mdx-fallback { border: 1px solid ${accent}; border-radius: 6px; padding: 8px 12px; margin: 12px 0; }
    .mdx-fallback-head { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; margin-bottom: 6px; font-size: 0.8em; }
    .mdx-fallback-name { font-weight: 600; color: ${accent}; font-family: monospace; }
    .mdx-fallback-attr { opacity: 0.7; }
    .mdx-fallback-body > :first-child { margin-top: 0; }
    .mdx-frontmatter { border-collapse: collapse; width: 100%; margin: 0 0 24px; font-size: 0.9em; }
    .mdx-frontmatter th, .mdx-frontmatter td { border: 1px solid ${border}; padding: 4px 10px; text-align: left; vertical-align: top; }
    .mdx-frontmatter th { width: 30%; font-weight: 600; opacity: 0.75; white-space: nowrap; }
    .mdx-scrollycoding { margin: 24px 0; }
    .mdx-scrollycoding-title { margin: 0 0 16px; font-size: 1.15em; }
    .mdx-scrollycoding-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 1.15fr); gap: 20px; align-items: start; }
    .mdx-scrollycoding-steps { display: flex; flex-direction: column; gap: 18px; }
    .mdx-scrollycoding-step { min-height: 34vh; padding: 14px 16px; border-left: 3px solid ${border}; opacity: 0.78; transition: border-color 160ms ease, opacity 160ms ease, background 160ms ease; }
    .mdx-scrollycoding-step-active { border-left-color: ${accent}; background: ${codeBg}; opacity: 1; }
    .mdx-scrollycoding-step-title { margin: 0 0 8px; font-size: 1em; line-height: 1.35; }
    .mdx-scrollycoding-step > :last-child { margin-bottom: 0; }
    .mdx-scrollycoding-code { position: sticky; top: 16px; min-width: 0; }
    .mdx-scrollycoding-code pre { margin: 0; max-height: calc(100vh - 48px); }
    .mdx-scrollycoding-static { border: 1px solid ${border}; border-radius: 6px; padding: 12px; }
    .mdx-print-placeholder { margin: 0 0 16px; padding: 12px; border: 1px solid ${border}; border-radius: 6px; color: ${muted}; background: ${codeBg}; }
    @media (max-width: 700px) {
      .mdx-scrollycoding-grid { grid-template-columns: 1fr; }
      .mdx-scrollycoding-step { min-height: auto; }
      .mdx-scrollycoding-code { position: static; }
      .mdx-scrollycoding-code pre { max-height: none; }
    }
    @media print {
      @page { margin: 0.75in; }
      html, body { background: #ffffff !important; color: #111111 !important; }
      body { max-width: none; padding: 0; font-size: 11pt; line-height: 1.5; }
      a { color: #111111 !important; text-decoration: underline; }
      .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6 { break-after: avoid; page-break-after: avoid; }
      .markdown-body h1 { font-size: 22pt; }
      .markdown-body h2 { font-size: 17pt; }
      .markdown-body h3 { font-size: 14pt; }
      .markdown-body img, .markdown-body pre, .markdown-body blockquote, .markdown-body table, .mdx-frontmatter, .mdx-fallback, .mdx-mermaid, .mdx-print-placeholder { break-inside: avoid; page-break-inside: avoid; }
      .markdown-body img { max-width: 100% !important; height: auto !important; }
      .markdown-body table { display: table; width: 100%; max-width: 100%; overflow: visible; }
      .markdown-body tr { break-inside: avoid; page-break-inside: avoid; }
      .markdown-body pre, .markdown-body pre *, .markdown-body :not(pre) > code { background: #f6f8fa !important; color: #111111 !important; }
      .markdown-body pre { white-space: pre-wrap; border: 1px solid #d8dee4; }
      .mdx-scrollycoding-grid { display: block; }
      .mdx-scrollycoding-step { min-height: auto; opacity: 1; background: transparent; break-inside: avoid; page-break-inside: avoid; }
      .mdx-scrollycoding-code { position: static; }
      .mdx-scrollycoding-code pre { max-height: none; }
    }
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

    const container = this.containerEl.children[1] as HTMLElement
    container.removeClass('mdx-editing')
    container.empty()
    this.editorEl = null

    const iframe = container.createEl('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.srcdoc = srcdoc
    iframe.addClass('mdx-preview-iframe')
    this.iframe = iframe
    container.appendChild(iframe)
    return true
  }

  async onClose() {
    if (this._renderTimer) window.clearTimeout(this._renderTimer)
    if (this._pendingPrintSnapshot) {
      window.clearInterval(this._pendingPrintSnapshot.resendTimer)
      window.clearTimeout(this._pendingPrintSnapshot.timeoutTimer)
      this._pendingPrintSnapshot = null
    }
    if (this.iframe) {
      this.iframe.remove()
      this.iframe = null
    }
    this._dataUrlCache.clear()
    this.editorEl = null
  }
}
