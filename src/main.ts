import { Plugin } from 'obsidian'
import { MDX_PREVIEW, mdxPreview } from './mdxPreview'

export default class ObsidianMDX extends Plugin {
  async onload() {
    this.registerView(MDX_PREVIEW, (leaf) => new mdxPreview(leaf))
    // Makes .mdx files appear in the file explorer and open directly in the preview view
    this.registerExtensions(['mdx'], MDX_PREVIEW)
  }
}
