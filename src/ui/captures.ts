import { call, type D } from './shared'

// CRM-009 offline capture. Staff capture people into this browser's IndexedDB
// first, under the signed-in member's email; each is synced once (the server
// keys it by its capture id, so a repeated sync adds nobody twice) and deleted
// here when the server has it. Sign-out deletes the member's unsynced captures
// only after warning with their count and offering to sync them first.

const DB = 'lodge-event-captures', STORE = 'captures'
/** LDG-004's file limit, which a resume photo is downsized to before it is stored. */
export const FILE_LIMIT = 1_000_000

export interface Capture { captureId: string; member: string; event: string; eventName: string; at: string; body: D }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'captureId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function store<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode), request = work(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}

export const unsynced = async (member: string) => (await store<Capture[]>('readonly', s => s.getAll() as IDBRequest<Capture[]>)).filter(c => c.member === member).sort((x, y) => x.at.localeCompare(y.at))
export const keep = (c: Capture) => store('readwrite', s => s.put(c))
const forget = (captureId: string) => store('readwrite', s => s.delete(captureId))
export async function forgetAll(member: string) { for (const c of await unsynced(member)) await forget(c.captureId) }

let syncing: Promise<{ left: number; refused: string[] }> | null = null

/** Send each of the member's captures; stop at the first network failure. Refusals stay on the device with their reason. One sync runs at a time. */
export function sync(member: string) {
  syncing ??= send(member).finally(() => { syncing = null })
  return syncing
}

async function send(member: string) {
  const refused: string[] = []
  for (const c of await unsynced(member)) {
    try {
      await call('command/event-capture', { ...c.body, event: c.event, captureId: c.captureId })
    } catch (e) {
      if (e instanceof TypeError || !navigator.onLine) break
      refused.push(`${c.body.name}: ${(e as Error).message}`)
      continue
    }
    await forget(c.captureId)
  }
  return { left: (await unsynced(member)).length, refused }
}

/** A resume photo over the limit is redrawn as a JPEG, smaller and lower quality step by step, until it fits; the result is what gets stored. */
export async function fitPhoto(file: File): Promise<Blob> {
  if (file.size <= FILE_LIMIT || !file.type.startsWith('image/')) return file
  const bitmap = await createImageBitmap(file)
  let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height)), quality = 0.85
  for (let attempt = 0; attempt < 16; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= FILE_LIMIT) return blob
    if (quality > 0.55) quality -= 0.1
    else scale *= 0.8
  }
  throw new Error('This photo could not be made small enough; take it again closer to the page')
}

export async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let raw = ''
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}

/** Sign out through Base's session route, then go to sign-in. */
export async function signOut() {
  await fetch('/auth/signout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  location.href = '/signin'
}
