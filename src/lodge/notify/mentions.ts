import type { State } from '../core/state'
import { canSeeApplication, canSeeCandidate, canSeeTeamNote, requireAdmin } from '../core/access'
import { requireThat, now, type Actor, type Data } from '../core/types'
import { memberActor } from './describe'
import { notify } from './emit'

// TEAM-002: @mentions in a team note. A mention is "@" and an active member's address (the note box suggests them as you
// type). Exact semantics:
// - the mentioned person is checked against their own live access to the candidate (and, for a private note, to that
//   note); mentioning never widens access, so a person who cannot see the candidate gets the note text with every
//   address and phone number taken out, no link and nothing that names the candidate's record;
// - where the employer turns on "refuse mentions without access", the whole note is refused, naming who needs access;
// - a private note can only mention someone who may read it;
// - editing a note alerts only the people newly mentioned.

const TOKEN = /(^|[^\w@.])@([\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,})/g
export const mentionsIn = (text: string) => [...new Set([...text.matchAll(TOKEN)].map(m => m[2].toLowerCase()))]

/** The note as someone without access reads it: names for addresses of members, no other address or phone number. */
function cleaned(s: State, text: string) {
  const named = text.replace(TOKEN, (_, lead, address) => lead + '@' + (s.find('member', address.toLowerCase())?.name ?? 'a colleague'))
  return named.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g, '[contact removed]').replace(/\+?\d[\d\s().-]{5,}\d/g, '[contact removed]').slice(0, 2000)
}

/** Admins decide whether a mention of someone without access is refused or delivered as text only. */
export function mentionPolicy(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const record = s.put('mention-policy', 'main', { refuseWithoutAccess: b.refuseWithoutAccess === true, by: a.email, at: now() })
  s.audit(a, 'mention-policy', 'mention-policy:main', { refuseWithoutAccess: record.refuseWithoutAccess })
  return record
}

/** Check every newly mentioned person of a saved note, refusing the note if the rules say so; returns what to raise once it is stored. */
export function checkMentions(s: State, a: Actor, note: Data, before: string[]) {
  const candidate = s.get('candidate', note.candidate), app = note.application ? s.get('application', note.application) : null
  const mentioned = mentionsIn(note.text), fresh = mentioned.filter(x => !before.includes(x))
  const refuse = s.find('mention-policy', 'main')?.refuseWithoutAccess === true
  const heard = fresh.map(address => {
    const member = s.find('member', address), who = memberActor(s, member)
    requireThat(who, `@${address} is not an active member you can mention`)
    const sees = canSeeCandidate(s, who, candidate) && (!app || canSeeApplication(s, who, app))
    if (note.private) requireThat(sees && canSeeTeamNote(s, who, note), `${member!.name} cannot read a private note; keep it shared or grant access first`, 409)
    requireThat(sees || !refuse, `${member!.name} cannot see this candidate; grant them access before mentioning them`, 409)
    return { address, sees }
  })
  return { mentioned, raise() { for (const { address, sees } of heard) notify(s, 'mention', [address], { vacancy: app ? s.get('vacancy', app.vacancy) : null, application: app, candidate: candidate.id, item: note.id, note: note.id, by: a.email, scope: 'addressed', ...(sees ? {} : { textOnly: true, excerpt: cleaned(s, note.text) }) }) } }
}
