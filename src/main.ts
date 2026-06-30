import { App, Editor, MarkdownView, Modal, Plugin } from 'obsidian'
import { MDXPreviewState, MDX_PREVIEW, mdxPreview } from './mdxPreview'

class MDXWarningModal extends Modal {
  private onConfirm: () => void

  constructor(app: App, onConfirm: () => void) {
    super(app)
    this.onConfirm = onConfirm
  }

  onOpen() {
    const { contentEl } = this
    contentEl.createEl('h2', { text: 'Security warning' })
    contentEl.createEl('p', {
      text: 'MDX preview executes JavaScript code contained in the file. Only preview files you trust.',
    })
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' })
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => {
      this.close()
    })
    buttons
      .createEl('button', { text: 'Preview anyway', cls: 'mod-warning' })
      .addEventListener('click', () => {
        this.close()
        this.onConfirm()
      })
  }

  onClose() {
    this.contentEl.empty()
  }
}

export default class ObsidianMDX extends Plugin {
  async onload() {
    this.registerView(MDX_PREVIEW, (leaf) => new mdxPreview(leaf))

    this.addCommand({
      id: 'preview',
      name: 'Preview',
      editorCheckCallback: (
        checking: boolean,
        _editor: Editor,
        view: MarkdownView
      ) => {
        if (view.file && view.file.extension === 'mdx') {
          if (!checking) {
            new MDXWarningModal(this.app, () => {
              this.app.workspace.detachLeavesOfType(MDX_PREVIEW)
              const leaf = this.app.workspace.getLeaf('tab')
              const viewState: MDXPreviewState = {
                data: view.data,
                basename: view.file!.basename,
              }
              leaf.setViewState({
                type: MDX_PREVIEW,
                state: viewState,
                active: true,
              })
              this.app.workspace.revealLeaf(leaf)
            }).open()
          }
          return true
        }
        return false
      },
    })
  }
}
