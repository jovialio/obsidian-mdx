# MDX Preview

Preview [MDX](https://mdxjs.com/) files in [Obsidian](https://obsidian.md), with first-class support for [Code Hike](https://codehike.org) — scrollycoding, code annotations, focus lines, and compile-time syntax highlighting.

Forked from [yulei-chen/obsidian-mdx](https://github.com/yulei-chen/obsidian-mdx) and rewritten with a security-first architecture, mobile compatibility, and offline rendering.

## Why this plugin

Most MDX-related plugins for Obsidian only handle **editing** — they register `.mdx` as a plain-text file so Obsidian stops treating it as unknown. None of them compile or render the MDX.

| Plugin | What it does | Compiles MDX | Code Hike | Mobile |
|---|---|:---:|:---:|:---:|
| **MDX Preview** (this plugin) | Compiles + renders MDX | Yes | Yes | Yes |
| MDX by yulei-chen | Preview (older architecture) | Yes | Yes | — |
| mdx as md | Edit .mdx as Markdown | No | No | — |
| Edit MDX | Edit and create .mdx files | No | No | — |
| Anything as Markdown | Treats .mdx as plain Markdown | No | No | — |

**MDX Preview** is the only plugin that compiles your MDX — JSX, React components, and Code Hike annotations all render correctly. Pair it with any of the edit-only plugins if you want richer editor support alongside the preview.

**Why not the original MDX by yulei-chen?** That plugin is the foundation this one was built on. This fork adds a security-first architecture (sandboxed iframe with a consent gate), bundles the renderer at build time so no internet connection is needed, and supports mobile.

## Features

- **Code Hike rendering** — scrollycoding, `!focus`, `!mark`, `!diff`, and all Code Hike annotations work out of the box
- **Compile-time syntax highlighting** — powered by [`@code-hike/lighter`](https://github.com/code-hike/lighter) (pure JavaScript, no native dependencies), so it works on iOS and Android
- **Sandboxed execution** — MDX JavaScript runs in a null-origin `sandbox="allow-scripts"` iframe with no access to your vault or Obsidian APIs
- **Session consent gate** — you confirm once per session before any MDX JavaScript runs
- **Offline** — the renderer is bundled at build time; no CDN calls are made at runtime
- **Auto-open** — `.mdx` files open directly in the preview view, no command palette step needed
- **Debounced live reload** — preview updates 400 ms after you stop typing

## Installation

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jovialio/obsidian-mdx/releases).
2. Copy them into `.obsidian/plugins/mdx-preview/` inside your vault.
3. Enable the plugin in **Settings → Community Plugins → Installed Plugins**.

### Community plugin browser

Once listed, search for **MDX Preview** in **Settings → Community Plugins → Browse** and click Install.

## Usage

1. Create or open any file with a `.mdx` extension — it opens automatically in the preview view.
2. On first open, click **Enable MDX Preview** in the consent banner. MDX files contain executable JavaScript; the plugin asks once per session before rendering.
3. Use the **pencil / book toggle** in the top-right of the tab to switch between the rendered preview and an editable source view. Edits are saved to the file automatically.

### Code Hike example

Copy this into a `.mdx` file to try Code Hike annotations:

````mdx
export function Code({ codeblock }) {
  return <pre>{codeblock.value}</pre>
}

## Annotated code

```js !focus
// !mark[/greet/] red
function greet(name) {
  // !mark green
  return `Hello, ${name}!`
}
```
````

For a full scrollycoding example, see the [Code Hike vite example](https://github.com/code-hike/codehike/blob/next/examples/vite/src/hello.mdx).

## Security model

MDX is executable JavaScript. This plugin takes several steps to limit the blast radius:

- The iframe uses `sandbox="allow-scripts"` with no `allow-same-origin`, giving it a null origin — vault files and Obsidian APIs are completely unreachable from inside the iframe
- No `eval()` or `new Function()` is used — the compiled MDX function body is embedded directly as a `<script>` tag, which is the same model browsers use for normal scripts
- The consent gate resets on every Obsidian restart, so you are always in control of when MDX JavaScript runs
- Outbound network requests from inside the iframe are still possible (this is a browser constraint, not something a plugin can block). Only preview files you trust.

## Contributing

Issues and pull requests are welcome at [jovialio/obsidian-mdx](https://github.com/jovialio/obsidian-mdx).

## Credits

Originally forked from [yulei-chen/obsidian-mdx](https://github.com/yulei-chen/obsidian-mdx) by [yulei-chen](https://github.com/yulei-chen). Thank you for the foundation.

## License

MIT — see the [LICENSE](LICENSE) file for details.
