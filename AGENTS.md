# AGENTS.md - obsidian-mdx

This repo is an Obsidian Community Plugin that renders `.mdx` files in a sandboxed preview iframe. Treat it like plugin code that runs beside a user's vault: security, offline behavior, and release hygiene matter more than cleverness.

## Project Shape

- Package manager: `pnpm`.
- Main plugin entry: `src/main.ts`.
- Obsidian preview wrapper: `src/mdxPreview.tsx`.
- Sandboxed iframe React renderer: `src/renderer.tsx`.
- Mermaid iframe helper bundle: `src/mermaidRenderer.ts`.
- Build config: `esbuild.config.mjs`.
- E2E tests: `tests/e2e/preview.spec.ts`.
- Generated release assets at repo root: `main.js`, `manifest.json`, `styles.css`.

## Core Architecture

- MDX compiles in the Obsidian host code, then runs inside an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`.
- The iframe has a null origin. Do not assume it can use Obsidian CSS variables, `app://` URLs, `blob:` URLs, vault APIs, or parent-window APIs.
- The consent gate is session-scoped and intentionally resets on restart/plugin reload. Do not bypass it.
- Runtime rendering must work offline. Do not add CDN or network-loaded renderer dependencies.
- Compiled MDX is embedded as a normal script/function body. Do not introduce `eval()` or `new Function()`.
- Always escape `</script` before embedding generated code or serialized data inside `srcdoc`.

## Host vs Iframe Rules

- In Obsidian host code, prefer Obsidian DOM helpers such as `container.createEl(...)` / `createDiv(...)` over raw `document.createElement(...)`; Obsidian's release scan warns on direct DOM creation.
- In iframe renderer code, use the iframe's own `window` and `window.document`. `activeWindow`, `activeDocument`, Obsidian APIs, and vault APIs do not exist there.
- Keep host responsibilities and iframe responsibilities separate:
  - Host: compile MDX, resolve local images, read Obsidian theme colors, assemble `srcdoc`.
  - Iframe: render React, Code Hike output, Mermaid SVGs, fallback components, and frontmatter table.

## Code Hike And Mermaid

- Keep Mermaid out of Code Hike. `remarkCodeHike` / `recmaCodeHike` should keep `ignoreCode: (codeblock) => codeblock.lang === 'mermaid'`.
- Mermaid fences should become normal Markdown `pre > code.language-mermaid` nodes, then `src/renderer.tsx` intercepts them via the `pre` component override.
- Do not make Code Hike understand Mermaid grammar; that path previously produced `No grammar provided for <markdown.mermaid.codeblock>` errors.
- Mermaid rendering belongs in `src/mermaidRenderer.ts`, exposed on `window.__mdxRenderMermaid`.
- Keep Mermaid `securityLevel: 'strict'` because the resulting SVG is inserted with `dangerouslySetInnerHTML`.
- A bad Mermaid diagram must render a local `.mdx-mermaid-error` block and must not blank the whole MDX preview.

## Bundle Size Discipline

- `src/renderer.tsx` is inlined into every preview iframe. Keep it small.
- Mermaid is large. Do not top-level import Mermaid from `src/renderer.tsx`; doing so makes every non-Mermaid preview pay the Mermaid payload cost.
- `src/mermaidRenderer.ts` is bundled as a separate IIFE and injected into `srcdoc` only when the compiled MDX contains `language-mermaid`.
- If adding another heavy renderer dependency, follow the Mermaid pattern: separate IIFE, local bundle, inject only when needed.

## Images And Vault Safety

- Local vault images are embedded as `data:` URLs when possible because null-origin iframes cannot load Obsidian `app://` resource URLs or host-created `blob:` URLs reliably.
- This means MDX JavaScript can read bytes for images the previewed file references. Keep the README security note in sync if image behavior changes.
- Literal JSX `<img>` tags bypass the MDX `components.img` override, so the iframe renderer also rewrites matching DOM images after render and via `MutationObserver`.

## TypeScript And Dependency Constraints

- The repo currently gates on TypeScript 4.7. Be careful with transitive type packages that require newer TS syntax.
- Mermaid pulls newer d3 type packages; `pnpm-workspace.yaml` pins `@types/d3-dispatch` to stay parser-compatible with TS 4.7.
- Build script intentionally uses `tsc -noEmit -skipLibCheck` before the production esbuild build.
- `pnpm-workspace.yaml` is where pnpm 10 build approvals live. Do not re-add stale `pnpm.onlyBuiltDependencies` to `package.json`.

## Validation Gate

Before calling code changes done, run:

```bash
pnpm run build
pnpm test
git diff --check
```

Notes:

- `pnpm test` runs Playwright against a synthetic sandboxed iframe. It covers the MDX compile/renderer pipeline, not the real Obsidian view wrapper.
- Changes to `src/main.ts` or `src/mdxPreview.tsx` still need manual Obsidian smoke testing in a test vault when practical.
- If Playwright lacks Chromium locally, run `pnpm exec playwright install chromium` once.
- Generated `main.js` and `styles.css` are committed/released assets; production builds will update them.

## Release Checklist

For a plugin release:

- Bump `package.json`, `manifest.json`, and `versions.json` together.
- Update README/release notes for user-visible behavior changes.
- Run the validation gate.
- Merge to `main`.
- Tags use plain semver, for example `0.1.17`, not `v0.1.17`.
- Release assets are `main.js`, `manifest.json`, and `styles.css`.
- The GitHub release workflow also builds/uploads those assets on tag push.
- After a merged PR, prune/delete stale local and remote feature branches when requested.

## PR Hygiene

- Keep changes tightly scoped. This repo is small enough that unrelated cleanup is easy to notice.
- For PRs that change renderer behavior, include or update Playwright coverage in `tests/e2e/preview.spec.ts`.
- For PRs that change release metadata, include package, manifest, and versions updates in the same PR.
- Watch bundle-size impact when adding dependencies. Note deliberate bundle tradeoffs in the PR description.
- Do not use `git add -A`; stage only files relevant to the task.
