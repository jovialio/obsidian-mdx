import { test, expect } from '@playwright/test'
import {
  ancestorDirs,
  appendObjectUrlFragment,
  appendResourceSuffix,
  decodeImageSource,
  extractImageSources,
  imageCandidatePaths,
  imageMimeTypeForPath,
  imageSourceSuffix,
  isExternalImageSource,
} from '../../src/imageSources'

// These exercise the pure host-side resolution logic directly — no browser, no
// Obsidian. The Playwright runner is reused only because it already compiles TS.

test.describe('extractImageSources', () => {
  test('captures inline, titled, and root-relative Markdown images', () => {
    const src = [
      '![Alt](./local.png)',
      '![Root](/images/root.png)',
      '![Titled](/x.png "a title")',
    ].join('\n\n')
    expect(extractImageSources(src)).toEqual(['./local.png', '/images/root.png', '/x.png'])
  })

  test('captures angle-bracketed sources containing spaces', () => {
    expect(extractImageSources('![Photo](<my file.png>)')).toEqual(['my file.png'])
  })

  test('captures titles that contain the other quote character', () => {
    expect(extractImageSources('![a](/y.png \'has "quotes"\')')).toEqual(['/y.png'])
    expect(extractImageSources('![a](/z.png "it\'s fine")')).toEqual(['/z.png'])
  })

  test('captures HTML img tags with double- or single-quoted src', () => {
    expect(extractImageSources('<img alt="x" src="/a.png" />')).toEqual(['/a.png'])
    expect(extractImageSources("<img src='/b.png'>")).toEqual(['/b.png'])
  })

  test('drops external sources (urls, protocol-relative, data, fragments)', () => {
    const src = [
      '![a](https://example.com/x.png)',
      '![b](//cdn.example.com/y.png)',
      '![c](data:image/png;base64,AAAA)',
      '![d](#anchor)',
      '![e](/keep.png)',
    ].join('\n\n')
    expect(extractImageSources(src)).toEqual(['/keep.png'])
  })
})

test.describe('isExternalImageSource', () => {
  test('classifies sources', () => {
    expect(isExternalImageSource('https://x/y.png')).toBe(true)
    expect(isExternalImageSource('HTTP://x/y.png')).toBe(true)
    expect(isExternalImageSource('//cdn/y.png')).toBe(true)
    expect(isExternalImageSource('data:image/png;base64,AA')).toBe(true)
    expect(isExternalImageSource('#frag')).toBe(true)
    expect(isExternalImageSource('')).toBe(true)
    expect(isExternalImageSource('/images/local.png')).toBe(false)
    expect(isExternalImageSource('./rel.png')).toBe(false)
  })
})

test.describe('decodeImageSource', () => {
  test('decodes percent-escapes and tolerates malformed input', () => {
    expect(decodeImageSource('/images/my%20file.png')).toBe('/images/my file.png')
    expect(decodeImageSource('/images/bad%.png')).toBe('/images/bad%.png')
  })
})

test.describe('ancestorDirs', () => {
  test('lists directories nearest-first up to the root', () => {
    expect(ancestorDirs('a/b/c')).toEqual(['a/b/c', 'a/b', 'a'])
    expect(ancestorDirs('a')).toEqual(['a'])
    expect(ancestorDirs('')).toEqual([])
  })
})

test.describe('imageCandidatePaths', () => {
  test('resolves relative sources against the note directory', () => {
    expect(imageCandidatePaths('img.png', 'blog/posts')).toEqual(['blog/posts/img.png'])
    expect(imageCandidatePaths('./sub/img.png', 'blog')).toEqual(['blog/./sub/img.png'])
    expect(imageCandidatePaths('img.png', '')).toEqual(['img.png'])
  })

  test('prefers the nearest ancestor public/ folder for root-relative sources', () => {
    // The intended project asset (blog/public/images/x.png) must be tried before
    // an incidental vault-root images/ folder shadows it.
    expect(imageCandidatePaths('/images/x.png', 'blog/posts')).toEqual([
      'blog/posts/public/images/x.png',
      'blog/posts/images/x.png',
      'blog/public/images/x.png',
      'blog/images/x.png',
      'public/images/x.png',
      'images/x.png',
    ])
  })

  test('strips query strings and fragments and decodes before building candidates', () => {
    expect(imageCandidatePaths('/images/my%20file.png?v=2#frag', '')).toEqual([
      'public/images/my file.png',
      'images/my file.png',
    ])
  })

  test('handles a root-level note (empty base dir)', () => {
    expect(imageCandidatePaths('/images/x.png', '')).toEqual([
      'public/images/x.png',
      'images/x.png',
    ])
  })
})

test.describe('imageSourceSuffix', () => {
  test('splits query and fragment', () => {
    expect(imageSourceSuffix('./sprite.svg#logo')).toEqual({ query: '', fragment: 'logo' })
    expect(imageSourceSuffix('./img.png?v=2')).toEqual({ query: 'v=2', fragment: '' })
    expect(imageSourceSuffix('./doc.pdf?a=1#page=2')).toEqual({ query: 'a=1', fragment: 'page=2' })
    expect(imageSourceSuffix('./plain.png')).toEqual({ query: '', fragment: '' })
  })
})

test.describe('appendResourceSuffix', () => {
  test('merges a query into a resource URL that already has one', () => {
    expect(appendResourceSuffix('app://local/x.png?1699', 'v=2', '')).toBe(
      'app://local/x.png?1699&v=2',
    )
  })

  test('adds a query when the resource URL has none', () => {
    expect(appendResourceSuffix('app://local/x.png', 'v=2', '')).toBe('app://local/x.png?v=2')
  })

  test('appends the fragment and leaves URLs without a suffix untouched', () => {
    expect(appendResourceSuffix('app://local/sprite.svg?1699', '', 'logo')).toBe(
      'app://local/sprite.svg?1699#logo',
    )
    expect(appendResourceSuffix('app://local/x.png?1699', '', '')).toBe('app://local/x.png?1699')
  })
})

test.describe('object URL helpers', () => {
  test('detects common image mime types from paths', () => {
    expect(imageMimeTypeForPath('public/images/photo.JPG')).toBe('image/jpeg')
    expect(imageMimeTypeForPath('diagram.svg#layer')).toBe('image/svg+xml')
    expect(imageMimeTypeForPath('asset.unknown')).toBe('application/octet-stream')
  })

  test('preserves fragments without adding obsolete cache-buster queries', () => {
    expect(appendObjectUrlFragment('blob:app://obsidian.md/123', 'logo')).toBe(
      'blob:app://obsidian.md/123#logo',
    )
    expect(appendObjectUrlFragment('blob:app://obsidian.md/123', '')).toBe(
      'blob:app://obsidian.md/123',
    )
  })
})
