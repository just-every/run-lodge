import type { PageProps } from './app'
import { day, when } from './format'
import { person } from './names'
import { Check, Field, Form, Status, type D } from './shared'

// OFFER-005: the reviewed disclosure and designated signers (admins), and an offer's native signing status, send,
// void, countersignature and signed files (people who run the job).

const signerOptions = (w: D) => (w.members ?? []).filter((m: D) => m.active && !m.agent && (m.owner || (w.esign?.signers ?? []).some((x: D) => x.email === m.email))).map((m: D) => ({ value: m.email, label: `${m.name} (${m.email})` }))

export function EsignSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  if (!w.esign || (!w.actor.owner && !w.actor.roles.includes('admin'))) return null
  const latest = w.esign.disclosure.at(-1), signers: D[] = w.esign.signers
  const candidates = (w.members ?? []).filter((m: D) => m.active && !m.agent && !m.owner && !signers.some(x => x.email === m.email)).map((m: D) => ({ value: m.email, label: `${m.name} (${m.email})` }))
  return <section className="card" aria-label="Electronic signature">
    <h2>Electronic signature</h2>
    <p className="hint">Native signing sends nothing until the disclosure is reviewed and each offer template version chooses it. Lodge makes no claim that electronic signature is legally adequate for your offers.</p>
    <h3>Consent disclosure{latest ? ` · version ${latest.version}` : ''}</h3>
    {latest ? <p className="hint">Reviewed by {person(w, latest.reviewedBy)} · fingerprint <code>{latest.fingerprint.slice(0, 12)}…</code>. Contact shown to candidates: {latest.contactName ? `${latest.contactName} at ${latest.contactEmail}` : 'the sending member'}.</p> : <p className="hint">No disclosure has been reviewed yet.</p>}
    <details><summary>{latest ? 'Review a new version' : 'Review the disclosure'}</summary><Form label="Save reviewed disclosure" compact onSubmit={x => mutate('esign-disclosure', { fee: x.fee, contactName: x.contactName, contactEmail: x.contactEmail, extra: x.extra, reviewed: x.reviewed === true })}>
      <Field label="Paper copy fee (blank means no charge)" name="fee" required={false} defaultValue={latest?.fee} />
      <Field label="Employer contact name (blank names the sending member)" name="contactName" required={false} defaultValue={latest?.contactName} />
      <Field label="Employer contact business email" name="contactEmail" type="email" required={false} defaultValue={latest?.contactEmail} />
      <Field label="Additional disclosure words" name="extra" type="textarea" wide required={false} defaultValue={latest?.extra} />
      <Check name="reviewed" label="I confirm the employer has reviewed the electronic signature disclosure" />
    </Form></details>
    <h3>Designated offer signers</h3>
    <p className="hint">Only these people (and the owner) countersign offers for the employer. {w.esign.notice}</p>
    <ul className="list">{signers.map(x => <li key={x.email}><span>{person(w, x.email)} · designated by {person(w, x.designatedBy)} on {day(x.at)}</span>
      <Form label={`Remove ${x.name}`} compact onSubmit={() => mutate('esign-signer', { email: x.email, designate: false })} /></li>)}</ul>
    {candidates.length > 0 && <Form label="Designate signer" compact onSubmit={x => mutate('esign-signer', { email: x.email })}><Field label="Member to designate" name="email" options={candidates} /></Form>}
  </section>
}

export function TemplateSigning({ latest, w }: { latest?: D; w: D }) {
  return <>
    <Check name="native" label="Send with Lodge-native electronic signature" defaultChecked={!!latest?.signing?.native} />
    <Check name="countersign" label="Require countersignature by a designated offer signer" defaultChecked={!!latest?.signing?.countersign} />
    <Field label="Default countersigner" name="signer" required={false} defaultValue={latest?.signing?.signer ?? ''} options={[{ value: '', label: 'None' }, ...signerOptions(w)]} />
  </>
}

const line = (e: D) => e.status === 'expired' ? 'link expired' : e.label

export function EsignPanel({ offer: o, app, w, mutate }: Pick<PageProps, 'w' | 'mutate'> & { offer: D; app: D }) {
  const e: D | null = o.esign, inFlight = e && ['active', 'candidate-signed'].includes(e.status) && !(e.status === 'active' && Date.parse(e.expiresAt) <= Date.now())
  const native = o.document?.signing?.native === true
  const mine = e?.status === 'candidate-signed' && e.countersign?.signer === w.actor.email
  if (!native && !e) return null
  return <section className="esign" aria-label="Native signature">
    <h4>Native signature</h4>
    {o.signature?.kind === 'native' && <p className="hint"><strong>{o.signature.label[0].toUpperCase() + o.signature.label.slice(1)}.</strong> <a href={`/api/lodge/download/document/${o.signature.document}`}>Signed offer (PDF)</a> · <a href={`/api/lodge/download/document/${o.signature.certificate}`}>Completion certificate (PDF)</a> · SHA-256 {o.signature.sha256.slice(0, 12)}…</p>}
    {e && <p className="hint"><Status tone={e.status === 'completed' ? 'good' : inFlight ? 'warn' : 'neutral'}>{line(e)}</Status> Sent to {e.recipient} by {person(w, e.sentBy)} · link expires {when(e.expiresAt)}{e.invitation?.status === 'failed' ? ' · the invitation was not handed to the mail provider: void this request and send again' : ''}{e.locked ? ' · link locked after too many codes' : ''}{e.voidReason ? ` · ${e.voidReason}` : ''}</p>}
    {e?.countersign?.required && <p className="hint">Countersigner: {person(w, e.countersign.signer)}</p>}
    {mine && <Form label="Countersign for the employer" compact onSubmit={x => mutate('esign/countersign', { id: e.id, name: x.name, hash: e.documentSha256 })}>
      <p>You sign for {e.businessName} as its designated offer signer. Lodge records the employer’s designation and does not verify signing authority. Your name, email, IP address and user agent appear on the certificate. You need a sign-in from the last 15 minutes.</p>
      <Field label="Type your full name" name="name" defaultValue={w.actor.name} />
    </Form>}
    {inFlight && <details><summary>Void or move this signing request</summary>
      <Form label="Void signing request" compact onSubmit={x => mutate('esign-void', { id: e.id, reason: x.reason })}><Field label="Reason" name="reason" /></Form>
      {e.countersign?.required && <Form label="Move countersignature" compact onSubmit={x => mutate('esign-move-signer', { id: e.id, signer: x.signer })}><Field label="Designated signer" name="signer" defaultValue={e.countersign.signer} options={signerOptions(w)} /></Form>}
    </details>}
    {native && o.status === 'draft' && o.approvedNow && app.status === 'active' && !inFlight && <Form label="Send for native signature" compact onSubmit={x => mutate('esign/send', { offer: o.id, days: x.days, countersign: x.countersign === true, signer: x.signer || undefined })}>
      <p>Lodge emails {e?.recipient ?? 'the candidate'} a signing link and, separately, a one-time code. Nothing is sent unless installation mail is set up.</p>
      <Field label="Days until the link expires (1 to 30)" name="days" type="number" defaultValue={7} />
      {!o.document.signing.countersign && <Check name="countersign" label="Also require countersignature" />}
      <Field label="Countersigner" name="signer" required={false} defaultValue={o.document.signing.signer ?? ''} options={[{ value: '', label: 'None' }, ...signerOptions(w)]} />
    </Form>}
    {native && o.status === 'draft' && !o.approvedNow && <p className="hint">Native signature needs a current approval of this exact document.</p>}
  </section>
}
