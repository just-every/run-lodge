import { requireAdmin } from '../core/access'
import type { State } from '../core/state'
import { base64ToBytes, bytesToBase64, now, optionalText, requireThat, text, type Actor, type Data } from '../core/types'

const MAX_LOGO_BYTES = 256 * 1024
type RasterType = 'image/png' | 'image/jpeg' | 'image/webp'
export interface CareersLogo { name: string; mediaType: RasterType; base64: string; size: number }
export interface CareersBrand {
  intro: string
  primaryColor: string
  backgroundColor: string
  textColor: string
  logo: CareersLogo | null
}
export type PublicEmployerBrand = CareersBrand & { logoSrc: string | null }

function color(value: unknown, label: string): string {
  requireThat(typeof value === 'string' && /^#[\da-f]{6}$/i.test(value), `${label} must use six hexadecimal digits, such as #123456`)
  return value.toLowerCase()
}

/** Relative luminance uses the sRGB transfer function, without rounding the ratio. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const channels = [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const first = luminance(color(foreground, 'Foreground color')), second = luminance(color(background, 'Background color'))
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function palette(input: Data) {
  const primaryColor = color(input.primaryColor, 'Primary color'), backgroundColor = color(input.backgroundColor, 'Background color'), textColor = color(input.textColor, 'Text color')
  requireThat(contrastRatio(textColor, backgroundColor) >= 4.5, 'Text and background colors must meet WCAG AA contrast of at least 4.5:1')
  // Links use primary on background; buttons use background on primary.
  requireThat(contrastRatio(primaryColor, backgroundColor) >= 4.5, 'Primary and background colors must meet WCAG AA contrast of at least 4.5:1 for links and buttons')
  return { primaryColor, backgroundColor, textColor }
}

/** Match the actual raster container, never the filename or a claimed MIME type alone. */
function rasterType(bytes: Uint8Array): RasterType | null {
  const is = (offset: number, signature: number[]) => signature.every((value, index) => bytes[offset + index] === value)
  const ascii = (offset: number, value: string) => is(offset, Array.from(value, char => char.charCodeAt(0)))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 45 && is(0, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (view.getUint32(8) !== 13 || !ascii(12, 'IHDR') || !view.getUint32(16) || !view.getUint32(20)) return null
    let offset = 8, imageData = false
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset)
      if (offset + length + 12 > bytes.length) return null
      if (ascii(offset + 4, 'IDAT')) imageData = true
      if (ascii(offset + 4, 'IEND')) return imageData && length === 0 && offset + 12 === bytes.length ? 'image/png' : null
      offset += length + 12
    }
    return null
  }
  if (bytes.length >= 4 && is(0, [255, 216, 255]) && is(bytes.length - 2, [255, 217])) {
    let offset = 2, frame = false, scan = false
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) return null
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217) return frame && scan && offset === bytes.length ? 'image/jpeg' : null
      if (marker === 0 || marker === 216 || marker === undefined || offset + 2 > bytes.length) return null
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) return null
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8 || !view.getUint16(offset + 3) || !view.getUint16(offset + 5)) return null
        frame = true
      }
      offset += length
      if (marker === 218) {
        scan = true
        while (offset < bytes.length) {
          if (bytes[offset] !== 255) { offset++; continue }
          const next = bytes[offset + 1]
          if (next === 0 || (next >= 208 && next <= 215)) { offset += 2; continue }
          break
        }
      }
    }
    return null
  }
  if (bytes.length >= 20 && ascii(0, 'RIFF') && ascii(8, 'WEBP') && view.getUint32(4, true) === bytes.length - 8
    && ['VP8 ', 'VP8L', 'VP8X'].some(type => ascii(12, type)) && view.getUint32(16, true) > 0
    && view.getUint32(16, true) + 20 <= bytes.length) return 'image/webp'
  return null
}

function logo(value: unknown): CareersLogo {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'Upload a PNG, JPEG or WebP logo')
  const input = value as Data
  requireThat(typeof input.base64 === 'string' && input.base64.length > 0, 'Logo bytes are required')
  requireThat(input.base64.length <= Math.ceil(MAX_LOGO_BYTES / 3) * 4, 'Logos may be at most 256 KiB', 413)
  requireThat(input.base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(input.base64), 'Logo bytes must be plain base64')
  const bytes = base64ToBytes(input.base64)
  requireThat(bytes.length > 0 && bytes.length <= MAX_LOGO_BYTES, 'Logos must contain at most 256 KiB of image bytes', 413)
  requireThat(bytesToBase64(bytes) === input.base64, 'Logo bytes must be canonical base64')
  const mediaType = rasterType(bytes)
  requireThat(mediaType && mediaType === input.mediaType, 'Logo bytes must match the PNG, JPEG or WebP image type; SVG and remote images are not allowed')
  return { name: text(input.name, 'Logo filename', 200).replace(/[\\/]/g, '_'), mediaType, base64: input.base64, size: bytes.length }
}

/** Human administration only. The original raster is small enough to live in this installation's JSON row. */
export function careersBrand(s: State, a: Actor, input: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'A person must save employer careers branding', 403)
  s.get('business', 'main')
  const current = s.find('careers-brand', 'main')
  const record: CareersBrand = {
    intro: optionalText(input.intro, 'Employer introduction', 8000), ...palette(input),
    logo: input.logo === undefined ? current?.logo ? logo(current.logo) : null : input.logo === null ? null : logo(input.logo),
  }
  const saved = s.put('careers-brand', 'main', { ...record, updatedAt: now(), updatedBy: a.email })
  s.audit(a, 'careers-brand-updated', 'careers-brand:main', { logo: record.logo?.name ?? null })
  return saved
}

/** Public pages receive only validated display values, without administration metadata. */
export function employerBrand(s: State): PublicEmployerBrand | null {
  const saved = s.find('careers-brand', 'main')
  if (!saved) return null
  const image = saved.logo ? logo(saved.logo) : null
  return { intro: optionalText(saved.intro, 'Employer introduction', 8000), ...palette(saved), logo: image,
    logoSrc: image ? '/careers/logo' : null }
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

/** Insert inside the public page's main element, including in an embedded careers page. */
export function brandHtml(brand: PublicEmployerBrand | null, employerName: string): string {
  if (!brand) return ''
  const image = brand.logo ? logo(brand.logo) : null
  const intro = optionalText(brand.intro, 'Employer introduction', 8000)
  return `<header class="employer-brand">${image ? `<img src="/careers/logo" alt="${escape(employerName)} logo">` : ''}${intro ? `<p>${escape(intro).replace(/\n/g, '<br>')}</p>` : ''}</header>`
}

/** Serve as /careers/brand.css. Apply employer-careers to the public html and main elements. */
export function brandCss(brand: CareersBrand | null): string {
  if (!brand) return ''
  const { primaryColor: primary, backgroundColor: background, textColor: ink } = palette(brand)
  return `.employer-careers{--rer-page:${background};--rer-surface:${background};--rer-text:${ink};--rer-muted:${ink};--rer-accent:${primary};--rer-focus:${primary}}
html.rer-themed.employer-careers body,html.rer-themed .employer-careers{background:${background};color:${ink}}
html.rer-themed.employer-careers main.lodge-public{background:${background};color:${ink}}
html.rer-themed.employer-careers :is(h1,h2,h3,label,legend,p,small,.meta,.roles span,fieldset p){color:${ink}}
html.rer-themed.employer-careers a{color:${primary};text-decoration:underline}
html.rer-themed.employer-careers :is(input,textarea,select,fieldset){background-color:${background};color:${ink};border-color:${ink}}
html.rer-themed.employer-careers button,html.rer-themed.employer-careers button:hover{background:${primary};color:${background};border-color:${primary}}
html.rer-themed.employer-careers :is(a,button,input,select,textarea):focus-visible{outline:2px solid ${primary};outline-offset:3px}
.employer-careers .employer-brand{display:grid;gap:12px;margin-bottom:24px;overflow-wrap:anywhere}
.employer-careers .employer-brand img{display:block;max-width:min(240px,100%);max-height:120px;width:auto;height:auto;object-fit:contain}
.employer-careers .employer-brand p{margin:0}`
}
