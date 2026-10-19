// Shared value types and input validation for Lodge's hiring records.
export type Data = Record<string, any>

export class Fault extends Error {
  /** The input field a refusal is about, for doors that answer field by field (ATTR-009). */
  field?: string
  constructor(public status: number, message: string) { super(message) }
}

/** Run a check and name the field any refusal from it is about. */
export function about<T>(field: string, check: () => T): T {
  try { return check() } catch (e) { if (e instanceof Fault) e.field ??= field; throw e }
}

export function requireThat(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new Fault(status, message)
}

export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()

export type Role = 'admin' | 'manager' | 'interviewer' | 'approver'
export const ROLES: Role[] = ['admin', 'manager', 'interviewer', 'approver']

/** The signed-in person behind a request, resolved from the native session only. */
export interface Actor {
  id: string
  email: string
  name: string
  session: string
  version: number
  owner: boolean
  roles: Role[]
  /** An agent member reads within its roles but can only propose; people apply changes. */
  agent: boolean
  /** Holds the "see private" permission: confidential jobs and private candidates are visible to them. */
  seePrivate?: boolean
  /** REQ-004: a manager's department (expanded to sub-departments) and office grants; they also run those jobs. */
  grants?: { departments: string[]; offices: string[]; /** OPS-004: the levels each granted department (and its sub-departments) or office carries. */ levels?: Record<string, string[]> }
  /** For an agent member: the person whose view it shares (their email). */
  scopeAs?: string
  /** Saved authorization revisions, also used by Base import and invitation batches. */
  memberships?: { email: string; revision: string | null }[]
}

/** Whose assignments and private notes this actor sees: an agent sees exactly its person's. */
export const scope = (a: Actor) => a.scopeAs ?? a.email

export function text(value: unknown, label: string, max = 200): string {
  requireThat(typeof value === 'string' && value.trim().length > 0, `${label} is required`)
  const trimmed = value.trim()
  requireThat(trimmed.length <= max, `${label} must be at most ${max} characters`)
  return trimmed
}

export function optionalText(value: unknown, label: string, max = 2000): string {
  if (value === undefined || value === null || value === '') return ''
  requireThat(typeof value === 'string', `${label} must be text`)
  requireThat(value.length <= max, `${label} must be at most ${max} characters`)
  return value.trim()
}

export function email(value: unknown, label = 'Email'): string {
  const result = text(value, label, 254).toLowerCase()
  requireThat(/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(result), `${label} must be a plain email address`)
  return result
}

export function optionalEmail(value: unknown, label = 'Email'): string {
  return value === undefined || value === null || value === '' ? '' : email(value, label)
}

export function date(value: unknown, label: string): string {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')), `${label} must be a date (YYYY-MM-DD)`)
  return value
}

export function instant(value: unknown, label: string): string {
  requireThat(typeof value === 'string' && !Number.isNaN(Date.parse(value)), `${label} must be a date and time`)
  return new Date(value).toISOString()
}

export function integer(value: unknown, label: string, min: number, max: number): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  requireThat(Number.isSafeInteger(number) && (number as number) >= min && (number as number) <= max, `${label} must be a whole number from ${min} to ${max}`)
  return number as number
}

export function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  requireThat(typeof value === 'string' && (values as readonly string[]).includes(value), `${label} must be one of: ${values.join(', ')}`)
  return value as T
}

export function list<T>(value: unknown, label: string, max: number, each: (item: unknown, index: number) => T): T[] {
  requireThat(Array.isArray(value), `${label} must be a list`)
  requireThat(value.length <= max, `${label} may have at most ${max} entries`)
  return value.map(each)
}

/** Money in integer minor units (cents) with an ISO currency. */
export function money(value: unknown, label: string): number {
  return integer(value, label, 0, 100_000_000_00)
}

export function currency(value: unknown): string {
  requireThat(typeof value === 'string' && /^[A-Z]{3}$/.test(value), 'Currency must be a three-letter code such as USD')
  return value
}

export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let raw = ''
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(raw)
}

/** Stable JSON with sorted keys, used to bind approvals to an exact version. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => (value as Data)[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical((value as Data)[k])).join(',') + '}'
  return JSON.stringify(value)
}
