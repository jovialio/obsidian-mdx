// Pure, Obsidian-independent helpers for locating local image references in
// MDX/Markdown source and mapping them onto candidate vault paths. Kept free of
// any `obsidian` import so the resolution logic can be unit-tested directly.

// Matches Markdown images (`![alt](src "title")`, including angle-bracketed
// `<...>` sources that may contain spaces) and raw HTML `<img src=...>` tags
// with double-, single-, or unquoted sources.
export const imageSourcePattern =
  /!\[[^\]]*\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)|<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

export function isExternalImageSource(src: string): boolean {
  return (
    src === '' ||
    src.startsWith('#') ||
    /^[a-z][a-z0-9+.-]*:/i.test(src) ||
    src.startsWith('//')
  )
}

// decodeURI, but never throws on malformed escapes — falls back to the input.
export function decodeImageSource(src: string): string {
  try {
    return decodeURI(src)
  } catch {
    return src
  }
}

// Every directory from `path` up to the vault root, nearest first.
export function ancestorDirs(path: string): string[] {
  const dirs: string[] = []
  let current = path

  while (current) {
    dirs.push(current)
    const next = current.split('/').slice(0, -1).join('/')
    if (next === current) break
    current = next
  }

  return dirs
}

// Vault-relative paths to probe for a local `src`, in priority order. For a
// root-relative `/images/...` reference the nearest ancestor `public/` folder is
// tried first (that is where a bundled site keeps its assets), then the same
// ancestor directly, then the vault-root `public/`, and finally the bare
// vault-root path as a last resort. Query strings and fragments are stripped and
// the path is percent-decoded before building candidates.
export function imageCandidatePaths(src: string, baseDir: string): string[] {
  const cleanSrc = src.split(/[?#]/, 1)[0]
  const decoded = decodeImageSource(cleanSrc)

  if (!decoded.startsWith('/')) {
    return [baseDir ? baseDir + '/' + decoded : decoded]
  }

  const trimmed = decoded.replace(/^\/+/, '')
  return [
    ...ancestorDirs(baseDir).flatMap((dir) => [dir + '/public/' + trimmed, dir + '/' + trimmed]),
    'public/' + trimmed,
    trimmed,
  ]
}

// Split a source into its query and fragment so they can be re-applied to the
// resolved resource URL. `imageCandidatePaths` strips these for the filesystem
// lookup, but they carry meaning at render time (SVG sprite `#id`, PDF
// `#page=2`, cache-busting `?v=`).
export function imageSourceSuffix(src: string): { query: string; fragment: string } {
  let rest = src
  let fragment = ''
  const hashIndex = rest.indexOf('#')
  if (hashIndex >= 0) {
    fragment = rest.slice(hashIndex + 1)
    rest = rest.slice(0, hashIndex)
  }
  let query = ''
  const queryIndex = rest.indexOf('?')
  if (queryIndex >= 0) {
    query = rest.slice(queryIndex + 1)
  }
  return { query, fragment }
}

// Re-attach a source's query/fragment to a resolved resource URL. Obsidian
// resource URLs already carry their own `?<cache-token>` query, so an extra
// query is merged with `&` rather than starting a second `?`.
export function appendResourceSuffix(url: string, query: string, fragment: string): string {
  let out = url
  if (query) out += (url.includes('?') ? '&' : '?') + query
  if (fragment) out += '#' + fragment
  return out
}

export function appendDataUrlFragment(url: string, fragment: string): string {
  return fragment ? url + '#' + fragment : url
}

export function imageMimeTypeForPath(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0]
  const extension = cleanPath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'avif':
      return 'image/avif'
    case 'bmp':
      return 'image/bmp'
    case 'gif':
      return 'image/gif'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

export function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    let chunkString = ''
    for (let j = 0; j < chunk.length; j++) {
      chunkString += String.fromCharCode(chunk[j])
    }
    binary += chunkString
  }

  return `data:${mimeType};base64,${btoa(binary)}`
}

// Every image `src` referenced in the source, in document order (with
// duplicates). External sources (URLs, data URIs, fragments) are dropped.
export function extractImageSources(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(imageSourcePattern)) {
    const src = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
    if (src && !isExternalImageSource(src)) found.push(src)
  }
  return found
}
