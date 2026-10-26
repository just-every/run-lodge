import { normalizeInbound, addresses } from '../../inbound.server.mjs'
import type { Bindings } from '../../auth.server'
import { actorFor, load, save } from '../core/store'
import type { State } from '../core/state'
import { can, canSeeContact, isAdmin, managesVacancy } from '../core/access'
import { bytesToBase64, email, Fault, now, requireThat, sha256, uid, type Actor, type Data } from '../core/types'

function eligible(s: State, a: Actor) {
  requireThat(!a.agent && (isAdmin(a) || s.scan('vacancy').some(v => managesVacancy(a, v) && can(s, a, v, 'contact'))), 'Capture not found', 404)
}

export function captureSettings(s: State, a: Actor) {
  eligible(s, a)
  const saved = s.find('capture-address', a.email)
  return saved?.operator === a.id ? saved.address as string : null
}

/** A separate capability address per member prevents sender headers from choosing a queue. */
export function captureAddress(s: State, a: Actor, domain: unknown) {
  eligible(s, a)
  requireThat(typeof domain === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain), 'Email routing domain is not configured', 409)
  const token = uid().replaceAll('-', '') + uid().replaceAll('-', '').slice(0, 16)
  const address = 'capture-' + token + '@' + domain.toLowerCase()
  s.put('capture-address', a.email, { member: a.email, operator: a.id, address, createdAt: now() })
  s.audit(a, 'capture-address-rotated', 'member:' + a.email)
  return { address, note: 'Private capability address; keep it in your own mail client. Rotation immediately refuses the previous address.' }
}

export async function contactDigest(s: State, address: string) {
  let key = s.find('capture-custody', 'main')
  if (!key) key = s.put('capture-custody', 'main', { secret: uid() + uid() })
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(address.toLowerCase()))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

/** Retain only a keyed suppression digest, never the erased address or message. */
export async function suppressErasedCapture(s: State, candidates: Data[]) {
  for (const c of candidates) if (c.email) {
    const digest = await contactDigest(s, c.email)
    s.put('capture-erased', digest, {})
    for (const m of s.scan('capture-mail')) if ((m.contactDigests ?? []).includes(digest)) {
      for (const f of m.attachments) s.drop('blob', f.id)
      s.remove('capture-mail', m.id)
    }
  }
}

function contact(s: State, a: Actor, id: string) {
  const c = s.find('candidate', id)
  requireThat(c && !c.deleted && !c.mergedInto && canSeeContact(s, a, c), 'Capture not found', 404)
  return c
}

/** Match aliases through reviewed merges, and fence every candidate used by the scope decision. */
function knownContacts(s: State, values: string[]) {
  const targets = new Map<string, Data>()
  for (const original of s.scan('candidate').filter(c => values.includes(c.email?.toLowerCase()))) {
    let c = s.get('candidate', original.id)
    const visited = new Set<string>()
    while (c.mergedInto) {
      requireThat(!visited.has(c.id), 'Capture not found', 404)
      visited.add(c.id)
      c = s.get('candidate', c.mergedInto)
    }
    if (!c.deleted) targets.set(c.id, c)
  }
  return [...targets.values()]
}

export function captureRead(s: State, a: Actor, id: string) {
  eligible(s, a)
  const m = s.find('capture-mail', id)
  requireThat(m, 'Capture not found', 404)
  if (m.candidate) contact(s, a, m.candidate)
  else requireThat(m.member === a.email && m.operator === a.id, 'Capture not found', 404)
  for (const c of knownContacts(s, m.contactAddresses)) contact(s, a, c.id)
  const { contactDigests, contactAddresses, operator, ...view } = m
  return view
}

export function captureList(s: State, a: Actor, candidate?: string) {
  eligible(s, a)
  if (candidate) contact(s, a, candidate)
  return s.all('capture-mail').filter(m => (candidate ? m.candidate === candidate : !m.candidate && m.member === a.email)).map(m => captureRead(s, a, m.id))
}

export function resolveCapture(s: State, a: Actor, input: Data) {
  const m = captureRead(s, a, input.id)
  requireThat(!m.candidate && m.member === a.email, 'Capture not found', 404)
  const c = contact(s, a, input.candidate)
  const saved = s.put('capture-mail', m.id, { ...s.get('capture-mail', m.id), candidate: c.id, resolvedAt: now() })
  s.audit(a, 'capture-resolved', 'candidate:' + c.id, { capture: m.id })
  return captureRead(s, a, saved.id)
}

/** Only a Cloudflare email event may call this door. No unsigned HTTP ingestion exists. */
export async function receiveCapture(message: ForwardableEmailMessage, env: Bindings) {
  const s = await load(env.DB)
  const address = s.scan('capture-address').find(r => r.address === message.to.toLowerCase())
  requireThat(address && env.CAPTURE_DOMAIN && message.to.toLowerCase().endsWith('@' + env.CAPTURE_DOMAIN.toLowerCase()), 'Capture refused', 550)
  s.get('capture-address', address.member)
  // Transport sender claims grant nothing: only possession of the private address selects custody.
  requireThat(message.from.toLowerCase() === address.member, 'Capture refused', 550)
  const operator = await env.DB.prepare("SELECT id,email,display_name,role,version FROM oa_operators WHERE email=? AND status='active'").bind(address.member).first<any>()
  requireThat(operator && operator.id === address.operator, 'Capture refused', 550)
  const actor = actorFor({ id: '', operator: { id: operator.id, email: operator.email, displayName: operator.display_name, role: operator.role, version: operator.version } }, s)
  eligible(s, actor)
  const mail = await normalizeInbound({ provider: 'cloudflare', message }, { maxRawBytes: 4000000, maxBodyBytes: 100000, maxAttachments: 10, maxAttachmentBytes: 1000000, maxTotalAttachmentBytes: 2000000 })
  const recipients = ['to', 'cc'].flatMap(header => message.headers.get(header) ? addresses(message.headers.get(header)!).map((v: string) => email(v)) : [])
  // Forwarded addresses are never used for automatic filing, but still trigger erasure suppression.
  const mentioned = [...new Set([...recipients, ...((mail.text + '\n' + mail.html).match(/[a-z0-9.!#$%&'*+_=^`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])])]
  requireThat(mentioned.length <= 100, 'Too many addresses in the message', 550)
  const contactDigests = await Promise.all(mentioned.map(value => contactDigest(s, value)))
  if (contactDigests.some(digest => s.find('capture-erased', digest))) { await save(env.DB, s, null); return }
  for (const c of knownContacts(s, mentioned.map(value => value.toLowerCase()))) contact(s, actor, c.id)
  const matches = knownContacts(s, recipients)
  const candidate = matches.length === 1 ? contact(s, actor, matches[0].id).id : null
  const fileHashes = await Promise.all(mail.attachments.map(async f => [f.filename, f.contentType, await sha256(f.content)]))
  const id = await sha256(new TextEncoder().encode(JSON.stringify([address.address, mail.messageId, mail.subject, mail.text, mail.html, recipients, fileHashes])))
  if (s.find('capture-mail', id)) return
  requireThat(s.scan('capture-mail').filter(m => !m.candidate && m.member === actor.email).length < 100, 'Resolve pending captures before receiving more', 550)
  const attachments = []
  for (const file of mail.attachments) {
    requireThat(file.content.length > 0, 'Empty attachments are refused', 550)
    const fileId = uid()
    s.put('blob', fileId, { base64: bytesToBase64(file.content), mediaType: file.contentType })
    attachments.push({ id: fileId, name: file.filename || 'attachment', mediaType: file.contentType, size: file.content.length, sha256: await sha256(file.content) })
  }
  s.put('capture-mail', id, { member: actor.email, operator: actor.id, candidate, subject: mail.subject, body: mail.text ?? '', to: recipients, receivedAt: now(), html: mail.html, contactDigests, contactAddresses: mentioned.map(value => value.toLowerCase()), attachments })
  s.audit(actor, 'mail-captured', candidate ? 'candidate:' + candidate : 'member:' + actor.email, { capture: id })
  // The saved member and all matching/contact records are revision fenced; the transport has no session.
  const guard = env.DB.prepare("INSERT INTO l_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND version=?) THEN 1 ELSE 0 END").bind(operator.id, operator.version)
  await save(env.DB, s, null, [guard])
}

export async function captureEmail(message: ForwardableEmailMessage, env: Bindings) {
  try { await receiveCapture(message, env) }
  catch (error) {
    if ((error instanceof Fault && [403, 404, 550].includes(error.status)) || (error instanceof Error && error.name === 'MailValidationError')) message.setReject('Capture refused')
    else throw error // Transient storage failures and revision conflicts must be retried by the transport.
  }
}
