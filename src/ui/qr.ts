// CRM-009: the QR code an event shows for attendees to register themselves.
// A plain QR Code Model 2 encoder (ISO/IEC 18004): byte mode, error correction
// level M, versions 1–10 (up to 213 bytes, ample for an event link), the mask
// with the lowest penalty. Rendered as an SVG path with a four-module quiet zone.

const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const FORMAT_M = 0

const rawModules = (ver: number) => {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) { const align = Math.floor(ver / 7) + 2; n -= (25 * align - 10) * align - 55; if (ver >= 7) n -= 36 }
  return n
}
const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver - 1] * BLOCKS[ver - 1]

function gfMul(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z
}
function rsDivisor(degree: number) {
  const result = new Array(degree - 1).fill(0).concat([1])
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) { result[j] = gfMul(result[j], root); if (j + 1 < result.length) result[j] ^= result[j + 1] }
    root = gfMul(root, 2)
  }
  return result
}
function rsRemainder(data: number[], divisor: number[]) {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ result.shift()!
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}

function codewords(bytes: number[], ver: number) {
  const bits: number[] = []
  const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capacity = dataCodewords(ver) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - bits.length % 8) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((x, b) => x << 1 | b, 0))
  const blocks = BLOCKS[ver - 1], eccLen = ECC_PER_BLOCK[ver - 1], raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = blocks - raw % blocks, shortLen = Math.floor(raw / blocks), divisor = rsDivisor(eccLen)
  const all: number[][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += block.length
    const ecc = rsRemainder(block, divisor)
    if (i < shortBlocks) block.push(0)
    all.push(block.concat(ecc))
  }
  const out: number[] = []
  for (let i = 0; i < all[0].length; i++) all.forEach((block, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]) })
  return out
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
]

/** The QR matrix for `text` (true = dark), row by row. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)]
  const ver = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find(v => 4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8)
  if (!ver) throw new Error('The link is too long for a QR code')
  const size = ver * 4 + 17
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, on: boolean) => { dark[y][x] = on; fixed[y][x] = true }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy))
    if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
  }
  if (ver >= 2) {
    const count = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2
    const at = [6]
    for (let pos = size - 7; at.length < count; pos -= step) at.splice(1, 0, pos)
    for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(at[i] + dx, at[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  }
  const format = (mask: number) => {
    const data = FORMAT_M << 3 | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = (data << 10 | rem) ^ 0x5412, bit = (i: number) => ((bits >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  format(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = ver << 12 | rem
    for (let i = 0; i < 18; i++) { const on = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, on); set(b, a, on) }
  }
  const data = codewords(bytes, ver)
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
      if (!fixed[y][x] && i < data.length * 8) { dark[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++ }
    }
  }
  let best: boolean[][] = dark, lowest = Infinity
  for (let m = 0; m < 8; m++) {
    const masked = dark.map((row, y) => row.map((on, x) => !fixed[y][x] && MASKS[m](x, y) ? !on : on))
    const keep = { dark: dark.map(r => [...r]) }
    for (let y = 0; y < size; y++) dark[y] = masked[y]
    format(m)
    const score = penalty(dark)
    if (score < lowest) { lowest = score; best = dark.map(r => [...r]) }
    for (let y = 0; y < size; y++) dark[y] = keep.dark[y]
  }
  return best
}

/** Runs of five or more, 2×2 blocks and dark/light balance (finder-like patterns are left out; any mask scans). */
function penalty(m: boolean[][]) {
  const size = m.length
  let score = 0, darkCount = 0
  for (let y = 0; y < size; y++) for (const line of [m[y], m.map(r => r[y])]) {
    let run = 1
    for (let x = 1; x <= size; x++) {
      if (x < size && line[x] === line[x - 1]) { run++; continue }
      if (run >= 5) score += run - 2
      run = 1
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) darkCount++
    if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  }
  return score + Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size)) * 10
}

/** An SVG path of the dark modules, offset by the quiet zone, and the viewBox size. */
export function qrPath(text: string) {
  const m = qrMatrix(text), size = m.length + 8
  let d = ''
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z` }))
  return { d, size }
}
