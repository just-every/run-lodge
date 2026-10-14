// Packs a folder into a stored (uncompressed) ZIP, the format any export tool
// can read, so fixture packages stay reviewable as plain files in the repository.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zip(entries) {
  const parts = [], central = []
  let offset = 0
  for (const { name, bytes } of entries) {
    const nameBytes = Buffer.from(name), crc = crc32(bytes)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26)
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(bytes.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(offset, 42)
    parts.push(local, nameBytes, bytes); central.push(dir, nameBytes)
    offset += 30 + nameBytes.length + bytes.length
  }
  const size = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

export async function folderEntries(root, dir = root) {
  const entries = []
  for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, item.name)
    if (item.isDirectory()) entries.push(...await folderEntries(root, path))
    else if (item.name !== 'README.md') entries.push({ name: relative(root, path).split('\\').join('/'), bytes: await readFile(path) })
  }
  return entries
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [folder, output] = process.argv.slice(2)
  await writeFile(output, zip(await folderEntries(folder)))
  console.log(`Wrote ${output}`)
}
