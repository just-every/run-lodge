import type { PageProps } from './app'
import { Check, Field, Form, Table, type D } from './shared'

export function PaySettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const rules: D[] = w.payRules ?? []
  const save = (next: D[]) => mutate('pay-rules', { rules: next })
  return <section aria-label="Pay transparency rules"><h2>Pay transparency rules</h2>
    <p>Record your counsel’s dated state and city review. Lodge requires approved USD pay for every location and refuses salary-history questions everywhere; these rules do not certify legal compliance.</p>
    <Table heads={['Jurisdiction', 'Reviewed', 'Requirements', '']} empty="No reviewed rules yet.">{rules.map(r => <tr key={r.place}><td>{r.place}</td><td>{r.reviewedOn}</td><td>{[r.rangeRequired && 'Pay range', r.benefitsRequired && 'Benefits and bonus', r.salaryHistoryBan && 'Salary-history ban'].filter(Boolean).join(', ')}</td><td><Form label="Remove rule" compact onSubmit={() => save(rules.filter(x => x.place !== r.place))} /></td></tr>)}</Table>
    <Form label="Save reviewed rule" reset onSubmit={x => save([...rules.filter(r => r.place.toLowerCase() !== x.place.trim().toLowerCase()), x])}>
      <Field label="State or city" name="place" />
      <Field label="Legal review date" name="reviewedOn" type="date" />
      <Check label="Pay range required" name="rangeRequired" defaultChecked />
      <Check label="Benefits and bonus text required" name="benefitsRequired" />
      <Check label="Salary-history ban" name="salaryHistoryBan" />
    </Form>
  </section>
}
