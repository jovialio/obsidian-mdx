import { Notice, Plugin } from 'obsidian'
import { MDX_PREVIEW, mdxPreview } from './mdxPreview'

export default class ObsidianMDX extends Plugin {
  async onload() {
    this.registerView(MDX_PREVIEW, (leaf) => new mdxPreview(leaf))

    // registerExtensions makes .mdx appear in the file explorer and open
    // directly in the preview view. Obsidian throws if another enabled plugin
    // (e.g. "Edit MDX" or "mdx as md") has already claimed the extension, so
    // guard it — otherwise that exception would abort the rest of onload.
    try {
      this.registerExtensions(['mdx'], MDX_PREVIEW)
    } catch (err) {
      console.error(
        'MDX Preview: could not register the ".mdx" extension. Another enabled ' +
          'plugin (such as "Edit MDX" or "mdx as md") is already handling it. ' +
          'Disable that plugin to let MDX Preview open .mdx files.',
        err,
      )
      new Notice(
        'MDX Preview: another plugin already handles ".mdx" files. ' +
          'Disable it, then reload Obsidian to use MDX Preview.',
        10000,
      )
    }
  }
}
