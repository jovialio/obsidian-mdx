# MDX Preview

Preview [MDX](https://github.com/mdx-js/mdx/) in Obsidian, with support for [Code Hike](https://github.com/code-hike/codehike).

## Installation

Install manually via the [GitHub releases](https://github.com/jovialio/obsidian-mdx/releases):

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Copy them into `.obsidian/plugins/mdx-preview/` inside your vault.
3. Enable the plugin in **Settings → Community Plugins**.

## Usage

1. Create or open any file with a `.mdx` extension — it opens automatically in the preview view.
2. On first open, confirm the security prompt. MDX files contain executable JavaScript; the plugin asks once per session before rendering.
3. Edit the file in a separate pane (source mode recommended) and the preview updates as you type.

### Code Hike support

The plugin has built-in support for [Code Hike](https://codehike.org). To try it out, copy [this example](https://github.com/code-hike/codehike/blob/next/examples/vite/src/hello.mdx) into a `.mdx` file in your vault.

## Contributing

Issues and pull requests are welcome at [jovialio/obsidian-mdx](https://github.com/jovialio/obsidian-mdx).

## License

MIT — see the [LICENSE](LICENSE) file for details.
