import { SOURCE_UI } from './copy'
import type { State } from '../core/state'
import { canonical, requireThat, type Data } from '../core/types'
import { jobForm } from '../records/questions'
import { schemaOf } from '../fields/schema'
import { cpraNotice, inCalifornia } from '../records/privacy'

/** A new language uses the same reviewed post bundle, with a complete form/receipt vocabulary. */
export function languageTag(value: unknown) {
  requireThat(typeof value === 'string' && value.length <= 35, 'Choose a language tag, such as en, es or fr')
  let tag = ''
  try { tag = Intl.getCanonicalLocales(value)[0] ?? '' } catch { /* Invalid tags are refused below. */ }
  requireThat(tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0, 'Choose a language supported by this installation')
  return tag.toLowerCase()
}

/** The source versions the employer reviews, including optional/restricted form text. */
export function translationSource(s: State, v: Data, post: Data) {
  const business = s.get('business', 'main')
  return canonical({ language: post.language, ...(post.language !== 'es' ? { interface: SOURCE_UI } : {}), notice: business.notices.at(-1), accommodation: business.accommodationContact,
    questions: jobForm(s, v, { ...post, language: 'en' }),
    fields: schemaOf(v).filter(f => f.record !== 'vacancy'),
    cpra: inCalifornia(s, v, post) ? cpraNotice(s) : null })
}

/** No source-language fallback: a partial draft can be saved, but cannot be published or served. */
export function requireTranslation(s: State, v: Data, post?: Data | null) {
  if (!post || post.language === 'en') return
  const t = post.translation
  requireThat(t?.reviewedBy && t.source === translationSource(s, v, post), 'Review the translation against the current notice and question versions before publishing this language', 409)
  const present = (value: unknown, label: string) => requireThat(typeof value === 'string' && value.trim(), `Missing ${post.language} translation: ${label}`, 409)
  if (post.language !== 'es') {
    for (const [key, source] of Object.entries(SOURCE_UI)) {
      present(t.ui?.[key], 'application text: ' + source)
      const required = (source.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
      const given = (String(t.ui[key]).match(/\{[a-zA-Z]+\}/g) ?? []).sort()
      requireThat(canonical(required) === canonical(given), `Keep the named values in the translation of: ${source}`, 409)
    }
  }
  present(t.notice, 'privacy notice'); present(t.accommodation, 'accommodation text'); present(t.monitoring, 'voluntary question')
  requireThat(Array.isArray(t.monitoringOptions) && t.monitoringOptions.length === 5, 'Translate every voluntary answer option', 409)
  t.monitoringOptions.forEach((x: unknown) => present(x, 'voluntary answer option'))
  for (const q of jobForm(s, v, { ...post, language: 'en' })) {
    const tr = t.questions?.[q.question]
    present(tr?.text, q.text)
    if (q.help) present(tr?.help, q.text + ' help')
    if (q.options.length) { requireThat(tr?.options?.length === q.options.length, `Translate every choice for ${q.text}`, 409); tr.options.forEach((x: unknown) => present(x, q.text + ' choice')) }
  }
  for (const f of schemaOf(v).filter(f => f.record !== 'vacancy')) {
    const tr = t.fields?.[f.id]
    present(tr?.name, f.name)
    if (f.choices?.length) { requireThat(tr?.choices?.length === f.choices.length, `Translate every choice for ${f.name}`, 409); tr.choices.forEach((x: unknown) => present(x, f.name + ' choice')) }
  }
  if (inCalifornia(s, v, post)) {
    const n = cpraNotice(s)
    requireThat(n && t.cpra?.categories?.length === n.categories.length, 'Translate the current California notice', 409)
    if (n.intro) present(t.cpra.intro, 'California introduction')
    present(t.cpra.saleStatement, 'California sale and sharing statement')
    for (const c of t.cpra.categories) for (const k of ['category', 'collected', 'purposes', 'retention']) present(c[k], 'California ' + k)
  }
}

export function translationReady(s: State, v: Data, post: Data) {
  try { requireTranslation(s, v, post); return true } catch { return false }
}
