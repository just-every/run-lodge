import type { State } from '../core/state'
import { isAdmin, requireAdmin, requireMember } from '../core/access'
import { email, now, optionalEmail, optionalText, requireThat, sha256, text, type Actor, type Data } from '../core/types'

// OFFER-005: the ESIGN/UETA consent disclosure and the business's list of designated offer signers. Lodge drafts
// the disclosure; the owner or a hiring admin confirms employer review for each immutable version.

export const SIGNING_NOTICE = 'Your name, email, IP address and user agent appear on the completion certificate that the candidate receives.'

export const DISCLOSURE_DRAFT = [
  'Consent to electronic signing of this offer',
  'You may ask for this offer on paper instead of signing electronically{{fee}}. To ask, write to {{contact}}.',
  'Your consent covers this offer only. It does not cover any other record or later offer.',
  'You may withdraw your consent before you sign by choosing "Withdraw consent" on the signing page. Withdrawing stops electronic signing of this offer; the offer stays open and {{business}} may continue on paper.',
  'To update your contact details, write to {{contact}}. A new email address needs a new signing request.',
  'To sign electronically you need a current web browser that can open PDF files and an email account that receives the one-time code.',
  'Selecting "Agree" confirms that you can open and read this offer in electronic form.',
].join('\n\n')

export interface DisclosureVersion { version: number; fee: string; contactName: string; contactEmail: string; extra: string; reviewedBy: string; at: string; fingerprint: string }

export const disclosureHistory = (s: State): DisclosureVersion[] => s.find('esign-disclosure', 'main')?.versions ?? []

/** The exact words a candidate reads, with the employer contact (default: the sending member) and fee merged in. */
export function disclosureText(version: DisclosureVersion, business: string, sender: { name: string; email: string }) {
  const contact = `${version.contactName || sender.name} at ${version.contactEmail || sender.email}`
  const body = DISCLOSURE_DRAFT.replaceAll('{{fee}}', version.fee ? ` (${version.fee})` : ' at no charge').replaceAll('{{contact}}', contact).replaceAll('{{business}}', business)
  return version.extra ? body + '\n\n' + version.extra : body
}

const shownText = (version: Omit<DisclosureVersion, 'fingerprint' | 'reviewedBy' | 'at' | 'version'>) => DISCLOSURE_DRAFT + '\u0000' + JSON.stringify(version)

/** Each confirmed review saves a new immutable version, fingerprinted. */
export async function esignDisclosure(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  requireThat(!a.agent, 'An agent can propose a disclosure but cannot review it', 403)
  requireThat(b.reviewed === true, 'Confirm employer review of the electronic signature disclosure before saving')
  const last = disclosureHistory(s).at(-1)
  const content = {
    fee: optionalText(b.fee ?? last?.fee, 'Paper copy fee', 200),
    contactName: optionalText(b.contactName ?? last?.contactName, 'Employer contact name', 160),
    contactEmail: optionalEmail(b.contactEmail ?? last?.contactEmail, 'Employer contact email'),
    extra: optionalText(b.extra ?? last?.extra, 'Additional disclosure words', 2000),
  }
  requireThat(!content.contactName === !content.contactEmail, 'Give the employer contact both a name and a business email, or leave both blank to name the sending member')
  const version: DisclosureVersion = { version: (last?.version ?? 0) + 1, ...content, reviewedBy: a.email, at: now(), fingerprint: await sha256(shownText(content)) }
  const record = s.put('esign-disclosure', 'main', { versions: [...disclosureHistory(s), version] })
  s.audit(a, 'esign-disclosure-reviewed', 'esign-disclosure:main', { version: version.version, fingerprint: version.fingerprint })
  return record
}

export const signerList = (s: State): Data[] => s.find('esign-signers', 'main')?.signers ?? []

/** The owner is always eligible; every other signer is a person an admin designated and who is still an active human member. */
export function isDesignated(s: State, who: string) {
  const member = s.find('member', who)
  if (!member?.active || member.agent) return false
  return member.owner === true || signerList(s).some(x => x.email === who)
}

/** The owner or a hiring admin designates (or removes) the people who countersign offers for the employer. */
export function esignSigner(s: State, a: Actor, b: Data) {
  requireThat(isAdmin(a) && !a.agent, 'Only the owner or a hiring admin keeps the designated offer signers', 403)
  const who = email(b.email, 'Signer')
  const list = signerList(s)
  if (b.designate === false) {
    requireThat(list.some(x => x.email === who), 'That person is not a designated offer signer', 409)
    const record = s.put('esign-signers', 'main', { signers: list.filter(x => x.email !== who) })
    s.audit(a, 'esign-signer-removed', 'member:' + who)
    return record
  }
  const member = requireMember(s, who)
  requireThat(member.active && !member.agent, 'A designated offer signer is an active person, not an agent', 409)
  requireThat(!list.some(x => x.email === who), 'That person is already designated', 409)
  const record = s.put('esign-signers', 'main', { signers: [...list, { email: who, name: text(member.name, 'Name'), designatedBy: a.email, at: now(), told: SIGNING_NOTICE }] })
  s.audit(a, 'esign-signer-designated', 'member:' + who, { informed: true })
  return record
}
