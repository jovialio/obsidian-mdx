export const printMessageMarker = 'mdx-preview'

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

function isAllowedImageDataUrl(value: string, element: Element, attrName: string): boolean {
  return (
    attrName === 'src' &&
    element.tagName.toLowerCase() === 'img' &&
    /^data:image\/(?:png|jpe?g|gif|webp|bmp);/i.test(value.trim())
  )
}

function normalizedProtocolValue(value: string): string {
  let normalized = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    if (code <= 0x20 || code === 0x7f) continue
    normalized += ch
  }
  return normalized.toLowerCase()
}

function shouldRemoveUrlAttribute(element: Element, attrName: string, value: string): boolean {
  const protocolValue = normalizedProtocolValue(value)
  if (protocolValue.startsWith('javascript:') || protocolValue.startsWith('vbscript:')) return true
  if (!protocolValue.startsWith('data:')) return false
  return !isAllowedImageDataUrl(value, element, attrName)
}

function sanitizeAttributes(root: ParentNode): void {
  root.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        return
      }
      if (
        (name === 'href' ||
          name === 'src' ||
          name === 'action' ||
          name === 'formaction' ||
          name.endsWith(':href')) &&
        shouldRemoveUrlAttribute(el, name, attr.value)
      ) {
        el.removeAttribute(attr.name)
      }
    })
  })
}

function removeNavigationElements(root: ParentNode): void {
  root.querySelectorAll('base, meta[http-equiv]').forEach((el) => el.remove())
}

function replaceEmbeddedElements(root: ParentNode): void {
  root.querySelectorAll('iframe, object, embed').forEach((el) => {
    const placeholder = el.ownerDocument.createElement('div')
    placeholder.className = 'mdx-print-placeholder'
    placeholder.textContent = 'Embedded content omitted for print.'
    el.replaceWith(placeholder)
  })
}

export function sanitizePrintSnapshotDocument(root: ParentNode): void {
  root.querySelectorAll('script').forEach((script) => script.remove())
  removeNavigationElements(root)
  replaceEmbeddedElements(root)
  sanitizeAttributes(root)
}

export function decoratePrintSnapshotHtml(html: string, title: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  sanitizePrintSnapshotDocument(doc)

  doc.title = title

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
}
