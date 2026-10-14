import { requireThat } from '../core/types'

// A small ZIP reader for owner-supplied export packages: the central directory
// lists entries; stored and deflated entries are supported, encryption and
// ZIP64 are refused with a plain message. Entry names are kept exactly.

export interface ZipEntry { name: string; bytes: Uint8Array }

const MAX_ENTRIES = 5000
const MAX_UNPACKED = 60_000_000

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  requireThat(end >= 0, 'This file is not a ZIP package')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  requireThat(count !== 0xffff && offset !== 0xffffffff, 'ZIP64 packages are not supported yet; split the export')
  requireThat(count <= MAX_ENTRIES, `Packages may hold at most ${MAX_ENTRIES} files`)
  const entries: ZipEntry[] = []
  let unpacked = 0
  const names = new TextDecoder('utf-8', { fatal: false })
  for (let n = 0; n < count; n++) {
    requireThat(view.getUint32(offset, true) === 0x02014b50, 'The ZIP directory is damaged')
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const name = names.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
    if (name.endsWith('/')) continue
    requireThat(!(flags & 1), `${name} is encrypted; export without a password`)
    requireThat(method === 0 || method === 8, `${name} uses an unsupported compression method`)
    requireThat(view.getUint32(local, true) === 0x04034b50, 'The ZIP entries are damaged')
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + compressed)
    requireThat(raw.length === compressed, `${name} is truncated`)
    unpacked += size
    requireThat(unpacked <= MAX_UNPACKED, 'The unpacked package is larger than this release accepts (60 MB)')
    const data = method === 0 ? raw.slice() : await inflate(raw)
    requireThat(data.length === size, `${name} did not unpack to its recorded size`)
    entries.push({ name, bytes: data })
  }
  return entries
}
