import { SOURCE_UI } from '../lodge/languages/copy'
import type { PageProps } from './app'
import { Check, Field, Form, type D } from './shared'

/** Employer-authored translations, reviewed with the current source wording beside each field. */
export function PostTranslation({ v, w, post, mutate }: { v: D; w: D; post: D; mutate: PageProps['mutate'] }) {
  const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(post.language) ?? post.language
  const t = post.translation ?? {}, notice = w.business?.notices?.at(-1)
  const questions: D[] = [...(v.questions ?? []), ...(post.questions ?? [])].map((x: D) => w.questions.find((q: D) => q.id === x.question)).filter(Boolean)
  const fields: D[] = (v.customSchema ?? []).filter((f: D) => f.record !== 'vacancy')
  const place = [v.location, ...[v.officeId, ...(v.locations ?? []), ...(post.locations ?? [])].map(id => w.offices?.find((o: D) => o.id === id)?.name)].filter(Boolean).join('; ')
  const cpra = /(^|\W)(California|CA)(\W|$)/i.test(place) ? w.cpraNotice : null
  return <details><summary>{language} translation for “{post.title}”</summary>
    <p>Translate the current source text below. A missing or outdated translation prevents publishing this language. Pause a live post before removing a translation. The post title and description above are its wording in this language.</p>
    <Form label="Save reviewed translation" onSubmit={x => mutate('post-translation', { vacancy: v.id, post: post.id, translation: {
      ...(v.benefits ? { benefits: x.benefits } : {}), notice: x.notice, accommodation: x.accommodationText, monitoring: x.monitoringText, ...(post.language !== 'es' ? { ui: Object.fromEntries(Object.keys(SOURCE_UI).map(k => [k, x['ui-' + k]])) } : {}),
      monitoringOptions: [0, 1, 2, 3, 4].map(i => x['monitoring-' + i]), reviewed: x.reviewed,
      questions: Object.fromEntries(questions.map(q => [q.id, { text: x['text-' + q.id], help: x['help-' + q.id], options: q.versions.at(-1).options.map((_: string, i: number) => x['option-' + q.id + '-' + i]) }])),
      fields: Object.fromEntries(fields.map(f => [f.id, { name: x['field-' + f.id], choices: f.choices.map((_: string, i: number) => x['choice-' + f.id + '-' + i]) }])),
      ...(cpra ? { cpra: { intro: x.cpraIntro, saleStatement: x.cpraSale, categories: cpra.categories.map((_: D, i: number) => Object.fromEntries(['category', 'collected', 'purposes', 'retention'].map(k => [k, x['cpra-' + i + '-' + k]]))) } } : {}),
    } })}>
      {v.benefits && <Field label={`${language} benefits and bonus description`} name="benefits" type="textarea" wide required={false} defaultValue={t.benefits} hint={v.benefits} />}
      <Field label={`${language} privacy notice (source version ${notice?.version})`} name="notice" type="textarea" wide required={false} defaultValue={t.notice} hint={notice?.text} />
      <Field label={`${language} accommodation text`} name="accommodationText" type="textarea" wide required={false} defaultValue={t.accommodation} hint={`Need an adjustment to apply or interview? Contact ${w.business?.accommodationContact}, or describe it below. Only hiring administrators see it.`} />
      <Field label={`${language} voluntary gender question`} name="monitoringText" type="textarea" wide required={false} defaultValue={t.monitoring} hint="How do you describe your gender?" />
      {['Prefer not to say', 'Woman', 'Man', 'Non-binary', 'Another description'].map((o, i) => <Field key={o} label={`${language}: ${o}`} name={'monitoring-' + i} required={false} defaultValue={t.monitoringOptions?.[i]} />)}
      {questions.map(q => { const source = q.versions.at(-1), tr = t.questions?.[q.id]; return <fieldset className="wide" key={q.id}><legend>{source.text} (version {source.version})</legend>
        <Field label={`${language} question: ${source.text}`} name={'text-' + q.id} required={false} defaultValue={tr?.text} />
        {source.help && <Field label={`${language} help: ${source.help}`} name={'help-' + q.id} required={false} defaultValue={tr?.help} />}
        {source.options.map((o: string, i: number) => <Field key={o} label={`${language} choice: ${o}`} name={'option-' + q.id + '-' + i} required={false} defaultValue={tr?.options?.[i]} />)}
      </fieldset> })}
      {fields.map(f => <fieldset className="wide" key={f.id}><legend>{f.name}</legend><Field label={`${language} field: ${f.name}`} name={'field-' + f.id} required={false} defaultValue={t.fields?.[f.id]?.name} />{f.choices.map((o: string, i: number) => <Field key={o} label={`${language} choice: ${o}`} name={'choice-' + f.id + '-' + i} required={false} defaultValue={t.fields?.[f.id]?.choices?.[i]} />)}</fieldset>)}
      {cpra && <fieldset className="wide"><legend>California privacy notice (version {cpra.version})</legend>
        <Field label={`${language} California introduction`} name="cpraIntro" required={false} defaultValue={t.cpra?.intro} hint={cpra.intro} />
        <Field label={`${language} California sale and sharing statement`} name="cpraSale" required={false} defaultValue={t.cpra?.saleStatement} hint={cpra.saleStatement} />
        {cpra.categories.map((c: D, i: number) => ['category', 'collected', 'purposes', 'retention'].map(k => <Field key={i + k} label={`${language} California ${k}: ${c[k]}`} name={'cpra-' + i + '-' + k} required={false} defaultValue={t.cpra?.categories?.[i]?.[k]} />))}
      </fieldset>}
      {post.language !== 'es' && <details className="wide"><summary>Application, receipt and candidate email text</summary><p>Translate every source phrase. Keep the named values in braces so that links, codes and notice versions reach the applicant.</p>{Object.entries(SOURCE_UI).map(([k, source]) => <Field key={k} label={`${language}: ${source}`} name={'ui-' + k} type="textarea" wide required={false} defaultValue={t.ui?.[k]} />)}</details>}
      <Check name="reviewed" label="The employer has reviewed these translations against the current source versions" />
    </Form>
  </details>
}
