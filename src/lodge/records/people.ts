import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { email, integer, list, now, oneOf, optionalText, requireThat, text, ROLES, type Actor, type Data } from '../core/types'
import { isZone } from '../core/time'
import { reassignTasks } from './tasks'

// The business's hiring settings and the people who can work in Lodge.

export function business(s: State, a: Actor, b: Data) {
  requireThat(a.owner, 'Only the owner can change business settings', 403)
  const current = s.find('business', 'main')
  const notice = text(b.privacyNotice, 'Applicant privacy notice', 20000)
  const notices: Data[] = current?.notices ?? []
  // Each wording change is a new notice version; submissions record the version they saw.
  if (notices.at(-1)?.text !== notice) notices.push({ version: notices.length + 1, text: notice, at: now() })
  const record = s.put('business', 'main', {
    name: text(b.name, 'Business name', 120),
    accommodationContact: text(b.accommodationContact, 'Accommodation contact', 300),
    retentionDays: integer(b.retentionDays, 'Retention period in days', 30, 3650),
    jurisdiction: optionalText(b.jurisdiction, 'Jurisdiction note', 500),
    // Every time Lodge shows or writes (interviews, history, receipts) reads in this zone, wherever it is opened.
    timeZone: zone(b.timeZone),
    notices,
  })
  // The owner always appears as a member so they can be chosen as manager, approver or interviewer.
  s.put('member', a.email, { email: a.email, name: a.name, roles: [...ROLES], active: true, owner: true })
  s.audit(a, current ? 'business-updated' : 'business-created', 'business:main')
  return record
}

function zone(value: unknown) {
  requireThat(isZone(value), 'Choose the time zone your business works in')
  return value
}

export function member(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(s.find('business', 'main'), 'Save the business settings first', 409)
  const address = email(b.email, 'Member email')
  const existing = s.find('member', address)
  requireThat(!existing?.owner, 'The owner keeps every role', 409)
  const agent = b.agent === true
  const actsFor = agent ? email(b.actsFor, 'The person this agent works for') : null
  if (actsFor) { const principal = s.find('member', actsFor); requireThat(principal?.active && !principal.agent && actsFor !== address, 'An agent acts for an active person') }
  // An agent's roles come from the person it acts for; it never holds roles of its own.
  const roles = agent ? [] : list(b.roles, 'Roles', ROLES.length, r => oneOf(r, ROLES, 'Role'))
  requireThat(roles.length > 0 || agent || b.active === false, 'Choose at least one role')
  // An agent reads its person's private notes and unreleased scorecards, so only the owner adds or changes one,
  // and an agent gets its own address: a person who is already a member never becomes one.
  requireThat(a.owner || (!agent && !existing?.agent), 'Only the owner can add or change an agent', 403)
  requireThat(!agent || !existing || existing.agent, 'An agent needs its own email address, not a person’s', 409)
  // Only the owner can create or change another admin.
  requireThat(a.owner || (!roles.includes('admin') && !existing?.roles?.includes('admin')), 'Only the owner can manage hiring admins', 403)
  const record = s.put('member', address, { email: address, name: text(b.name, 'Member name', 120), roles: [...new Set(roles)], active: b.active !== false, owner: false, agent, actsFor })
  if (existing?.active && !record.active) reassignTasks(s, a, address)
  s.audit(a, existing ? 'member-updated' : 'member-added', 'member:' + address, { roles: record.roles, active: record.active, agent, actsFor })
  return record
}
