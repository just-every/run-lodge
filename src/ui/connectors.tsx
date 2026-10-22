import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

export function ConnectorSettings({ w, mutate }: Pick<PageProps, 'w' | 'mutate'>) {
  const summary = w.connectors
  if (!summary) return null
  return <section aria-label="Connector registry"><h2>Connector registry</h2><p>{summary.note}</p>
    {summary.catalog.map((p: D) => {
      const r = p.registration
      return <article className="card" key={p.id} aria-label={p.name + ' registry'}><h3>{p.name}</h3><p>{p.note}</p>
        <p>{r ? `${r.status} · generation ${r.generation} · access unknown` : 'Not registered · access unknown'}</p>
        <Form key={r?.generation ?? 'new'} label={'Save ' + p.name + ' registration'} onSubmit={x => mutate('connector-register', {
          provider: p.id, generation: r?.generation, sender: x.sender, organizer: x.organizer,
          scopes: p.scopes.filter((v: string) => x['scope:' + v]), bindings: p.bindings.filter((v: string) => x['binding:' + v]),
          mappings: p.fields.filter((v: string) => x['mapping:' + v]).map((v: string) => ({ from: v, to: v })),
        })}>
          <Field label="Selected sender" name="sender" type="email" required={false} defaultValue={r?.sender} />
          <Field label="Selected organizer" name="organizer" type="email" required={false} defaultValue={r?.organizer} />
          {p.scopes.map((v: string) => <Check key={v} label={'Requested scope: ' + v} name={'scope:' + v} defaultChecked={r?.scopes.includes(v)} />)}
          {p.bindings.map((v: string) => <Check key={v} label={'Declared secret binding: ' + v} name={'binding:' + v} defaultChecked={r?.bindings.includes(v)} />)}
          {p.fields.map((v: string) => <Check key={v} label={'Map field: ' + v} name={'mapping:' + v} defaultChecked={r?.mappings.some((m: D) => m.from === v && m.to === v)} />)}
        </Form>
        {r && r.status !== 'disconnected' && <><Form compact label={'Record ' + p.name + ' credential rotation'} onSubmit={() => mutate('connector-binding-change', { provider: p.id, generation: r.generation, action: 'rotation-recorded' })}><p>Use after changing the secret in installation setup. This records the change only.</p></Form>
          <Form compact label={'Disconnect ' + p.name + ' registry'} onSubmit={() => mutate('connector-binding-change', { provider: p.id, generation: r.generation, action: 'disconnect' })}><p>Stops this registration. Revoke provider access and remove installation secrets separately. Existing installation mail is configured in setup.</p></Form></>}
      </article>
    })}
  </section>
}
