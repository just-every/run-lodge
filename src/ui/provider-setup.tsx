import type { PageProps } from './app'
import { Check, Field, Form, Table, type D } from './shared'

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

export function ProviderSetup({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const summary = w.providerSetup
  if (!summary) return null
  return <section aria-label="Provider setup"><h2>Provider setup and costs</h2><p>{summary.note}</p>
    <Table heads={['Enabled service', 'Employer plan', 'Monthly estimate (USD)', 'Confirmation']} empty="No enabled service costs.">{summary.lines.map((p: D) => <tr key={p.id}><td>{p.name}</td><td>{p.setup.plan}</td><td>{usd(p.setup.monthlyCents)}</td><td>{p.setup.planConfirmed ? 'Plan confirmed' : 'Plan confirmation missing'}</td></tr>)}</Table>
    <p><strong>Estimated monthly total: {usd(summary.totalMonthlyCents)} USD</strong></p>
    {summary.catalog.map((p: D) => {
      const saved = p.setup ?? {}
      return <article className="card" key={p.id} aria-label={p.name + ' setup'}><h3>{p.name}</h3><p>{p.plan}</p><p>{p.app}</p><p>{p.legal}</p>
        <p><a href={p.docs} target="_blank" rel="noreferrer">Provider requirements</a> · <a href={p.accountDocs} target="_blank" rel="noreferrer">Account prerequisites</a></p>
        <p>{p.connection}</p>
        <Form key={saved.updatedAt ?? p.id} label={'Save ' + p.name + ' estimate'} onSubmit={x => mutate('provider-setup', { ...x, provider: p.id, enabled: true })}>
          <Field label="Employer plan or package" name="plan" defaultValue={saved.plan} />
          <Field label={'Monthly volume (' + p.unit + ')'} name="volume" type="number" defaultValue={saved.volume} />
          <Field label="Employer-entered unit price (USD)" name="unitPriceUsd" defaultValue={saved.unitPriceUsd} hint="Up to six decimals; enter the rate from your own provider agreement." />
          <Field label="Fixed monthly fees (USD)" name="monthlyBaseUsd" defaultValue={saved.monthlyBaseUsd} />
          <Field label="One-time setup fees (USD)" name="oneTimeUsd" defaultValue={saved.oneTimeUsd ?? '0'} />
          <Field label="Pricing source and date" name="priceBasis" defaultValue={saved.priceBasis} />
          <Check name="planConfirmed" label="Employer confirms this required plan and pricing" defaultChecked={saved.planConfirmed} />
          <Check name="appConfirmed" label="Employer confirms required app/API access" defaultChecked={saved.appConfirmed} />
          <Check name="legalConfirmed" label="Employer confirms legal configuration review" defaultChecked={saved.legalConfirmed} />
        </Form>
        {saved.enabled && <><p>One-time estimate: {usd(saved.oneTimeCents)} USD. {saved.reviewed ? 'Setup reviewed; connector unavailable.' : 'Setup awaiting review.'}</p>
          <Form label={'Review ' + p.name + ' setup'} compact onSubmit={() => mutate('provider-review', { provider: p.id, version: p.version })} />
          <Form label={'Disable ' + p.name} compact onSubmit={() => mutate('provider-setup', { provider: p.id, enabled: false })} /></>}
      </article>
    })}
  </section>
}
