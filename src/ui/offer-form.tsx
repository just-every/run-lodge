import type { PageProps } from './app'
import { cents, Check, Field, Form, type D } from './shared'
import { offerReference, offerReferenceValue, offerTemplateOptions } from './offer-templates'

export function OfferForm({ app, v, w, mutate, offer }: Pick<PageProps, 'w' | 'mutate'> & { app: D; v?: D; offer?: D }) {
  return <Form label={offer ? 'Regenerate offer document' : 'Save offer'} reset={!offer} onSubmit={x => mutate('offer', {
    id: offer?.id, application: app.id, title: x.title, startDate: x.startDate, terms: x.terms, opening: x.opening || undefined, conditional: x.conditional === true,
    salary: { currency: x.currency.toUpperCase(), amount: cents(x.amount), period: x.period },
    offerTemplate: offerReference(x.offerTemplate), location: x.offerLocation, employmentType: x.offerEmploymentType,
    bonus: cents(x.bonus || '0'), equity: x.equity, contingencies: x.contingencies || undefined,
  })}>
    <Field label="Job title" name="title" defaultValue={offer?.title ?? v?.title} />
    <Field label="Start date" name="startDate" type="date" defaultValue={offer?.startDate} />
    <Field label="Currency" name="currency" defaultValue={offer?.salary.currency ?? v?.compensation?.currency ?? 'USD'} />
    <Field label="Pay" name="amount" type="number" defaultValue={offer ? offer.salary.amount / 100 : ''} />
    <Field label="Pay period" name="period" defaultValue={offer?.salary.period ?? v?.compensation?.period ?? 'year'} options={[{ value: 'year', label: 'per year' }, { value: 'month', label: 'per month' }, { value: 'hour', label: 'per hour' }]} />
    <Field label="Other terms" name="terms" type="textarea" wide required={false} defaultValue={offer?.terms} />
    {!!w.offerTemplates?.length && <>
      <Field label="Reviewed document template (optional)" name="offerTemplate" required={false} defaultValue={offerReferenceValue(offer?.document?.template ?? v?.offerTemplate)} options={offerTemplateOptions(w)} />
      <Field label="Offer location" name="offerLocation" defaultValue={offer?.location ?? v?.location} />
      <Field label="Offer employment type" name="offerEmploymentType" defaultValue={offer?.employmentType ?? v?.employmentType} />
      <Field label="Bonus (USD)" name="bonus" type="number" defaultValue={(offer?.bonus ?? 0) / 100} />
      <Field label="Equity terms" name="equity" type="textarea" required={false} defaultValue={offer?.equity} />
      <Field label="Offer contingencies (blank uses reviewed template)" name="contingencies" type="textarea" required={false} defaultValue={offer?.contingencies} />
    </>}
    <Check name="conditional" label="Conditional offer: any background check comes after it" defaultChecked={offer?.conditional} />
    {(v?.openings ?? []).some((o: D) => o.status === 'open') && <Field label="Opening it fills" name="opening" defaultValue={offer?.opening ?? v!.openings.find((o: D) => o.status === 'open').id} options={v!.openings.filter((o: D) => o.status === 'open').map((o: D) => ({ value: o.id, label: o.code }))} />}
  </Form>
}

export function OfferDocument({ offer, app, v, w, mutate }: Pick<PageProps, 'w' | 'mutate'> & { offer: D; app: D; v?: D }) {
  if (!offer.document) return null
  return <section className="prepared-offer" aria-label="Prepared offer document">
    <h4>{offer.document.template.name} · version {offer.document.template.version}</h4>
    <p className="hint">Prepared, unsent. Approval binds this document and every compensation term. SHA-256 <code>{offer.document.sha256}</code></p>
    <pre>{offer.document.text}</pre>
    {offer.approvedNow && <p><a href={`/api/lodge/download/prepared-offer/${offer.id}`}>Download approved document (unsent)</a></p>}
    {offer.status === 'draft' && <details><summary>Revise prepared offer (needs approval again)</summary><OfferForm app={app} v={v} w={w} mutate={mutate} offer={offer} /></details>}
  </section>
}
