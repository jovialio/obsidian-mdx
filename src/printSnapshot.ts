export const printMessageMarker = 'mdx-preview'
export const printReadyTimeoutMs = 2500

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
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase()
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

function printReadyScript(): string {
  return `
(() => {
  const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const printWhenReady = () => {
    const images = Array.from(document.images).filter((img) => !img.complete)
    const imageReady = Promise.all(images.map((img) => new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true })
      img.addEventListener('error', resolve, { once: true })
    }))).catch(() => undefined)
    const fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.then(() => undefined).catch(() => undefined)
      : Promise.resolve()
    Promise.race([Promise.all([imageReady, fontsReady]), timeout(${printReadyTimeoutMs})]).then(() => {
      setTimeout(() => {
        window.focus()
        window.print()
      }, 50)
    })
  }
  window.addEventListener('afterprint', () => {
    setTimeout(() => window.close(), 100)
  })
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', printWhenReady, { once: true })
  } else {
    printWhenReady()
  }
})()
`
}

export function decoratePrintSnapshotHtml(html: string, title: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  sanitizePrintSnapshotDocument(doc)

  let titleEl = doc.head.querySelector('title')
  if (!titleEl) {
    titleEl = doc.createElement('title')
    doc.head.appendChild(titleEl)
  }
  titleEl.textContent = title

  const script = doc.createElement('script')
  script.textContent = printReadyScript()
  doc.body.appendChild(script)

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML
}
