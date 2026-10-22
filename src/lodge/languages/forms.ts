import { times } from '../core/time'
import { draftTools } from '../careers/draft'
import { requireThat, type Data } from '../core/types'
import { schemaOf } from '../fields/schema'
import { MONITORING_OPTIONS } from '../records/intake'
import { amount } from '../core/labels'

import { SPANISH, uiCopy } from './copy'
export { SPANISH, SOURCE_UI, UI_KEYS, uiCopy } from './copy'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const paragraphs = (v: string) => esc(v).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

/** Dictionary content and substitutions are text. Only the fixed privacy link is application HTML. */
function message(copy: Record<string, string>, key: string, values: Data = {}) {
  const template = copy[key]
  requireThat(typeof template === 'string' && template.trim(), 'Missing translated application interface: ' + key, 409)
  return template.split(/(\{[a-zA-Z]+\})/).map(part => {
    if (!/^\{[a-zA-Z]+\}$/.test(part)) return esc(part)
    const name = part.slice(1, -1)
    if (name === 'privacyPath') return '<a href="/privacy-requests">/privacy-requests</a>'
    requireThat(Object.hasOwn(values, name), 'Unsupported translated interface placeholder', 409)
    return esc(values[name])
  }).join('')
}

export type TranslatedQuestions = (questions: Data[], values: Data, copy: Record<string, string>) => string

/** Shared translated scaffold; notices, questions and custom labels retain employer-authored translations. */
export function translatedForm(v: Data, business: Data, error: string, values: Data, questions: Data[], action: string,
  hidden: Record<string, string>, cpra: Data | null, questionFields: TranslatedQuestions, copy: Record<string, string> = uiCopy(v)) {
  const tr = v.translation, notice = business.notices.at(-1)
  const m = (key: string, substitutions: Data = {}) => message(copy, key, substitutions)
  const field = (name: string, key: string, type = 'text', extra = '') => `<label>${m(key)}<input name="${name}" type="${type}" value="${esc(values[name])}" ${extra}></label>`
  const c = v.compensation
  const period = c && ({ year: 'payYear', month: 'payMonth', hour: 'payHour' } as Record<string, string>)[c.period]
  requireThat(!c || period, 'Unsupported translated pay period', 409)
  // Currency formatting retains Lodge's existing amount representation; the period is always translated.
  const pay = c ? `${amount(c.min, c.currency)}–${amount(c.max, c.currency)} ${copy[period]}` : ''
  const mode = v.workMode ? m(v.workMode) : ''
  const employmentKey = ({ 'full-time': 'fullTime', 'part-time': 'partTime', contract: 'contract', temporary: 'temporary' } as Record<string, string>)[v.employmentType]
  requireThat(!v.employmentType || employmentKey, 'Unsupported translated employment type', 409)
  const facts = [esc(v.location), mode, employmentKey ? m(employmentKey) : ''].filter(Boolean).join(' · ')
  const custom = schemaOf(v).filter(f => f.record !== 'vacancy').map(f => {
    const q = tr.fields[f.id], name = 'cf-' + f.id, req = f.requiredStages.includes(v.stages[0]?.id) ? ' required' : ''
    const label = esc(q.name) + (req ? '' : m('optional'))
    const help = f.restricted ? `<small>${m('restrictedHelp')}</small>` : ''
    if (f.type === 'choice' || f.type === 'boolean') {
      const options = f.type === 'boolean' ? [['true', copy.yes], ['false', copy.no]] : f.choices.map((o, i) => [o, q.choices[i]])
      return `<label${f.restricted ? ' data-draft-private' : ''}>${label}${help}<select name="${esc(name)}"${req}><option value="">${m('choose')}</option>${options.map(([value, title]) => `<option value="${esc(value)}"${values[name] === value ? ' selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`
    }
    return `<label${f.restricted ? ' data-draft-private' : ''}>${label}${help}<input name="${esc(name)}" type="${f.type === 'text' ? 'text' : esc(f.type)}" value="${esc(values[name])}"${req}></label>`
  }).join('')
  const california = cpra ? `<details><summary>${m('californiaNotice', { version: cpra.version })}</summary>${paragraphs(tr.cpra.intro || '')}<dl>${tr.cpra.categories.map((category: Data) => `<dt>${esc(category.category)}</dt><dd>${esc(category.collected)} ${esc(category.purposes)} ${esc(category.retention)}</dd>`).join('')}</dl><p>${esc(tr.cpra.saleStatement)}</p><p>${m('californiaRequest')}</p></details><input type="hidden" name="cpraNoticeVersion" value="${esc(cpra.version)}">` : ''
  return `<h1>${esc(v.title)}</h1><p class="meta">${facts}${pay ? `<br>${m('salary', { pay })}` : ''}</p>${paragraphs(v.description || '')}
${error ? `<p role="alert" class="error">${m('refusal')}</p>` : ''}
<h2>${m('apply')}</h2><p>${esc(tr.accommodation)} ${esc(business.accommodationContact)}</p>
<form method="post" enctype="multipart/form-data" action="${esc(action)}">
${Object.entries(hidden).map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`).join('')}
${field('name', 'name', 'text', 'required autocomplete="name" maxlength="160"')}
${field('email', 'email', 'email', 'required autocomplete="email"')}
${field('phone', 'phone', 'tel', 'autocomplete="tel"')}
${field('location', 'location', 'text', 'autocomplete="address-level2"')}
<label>${m('resume')}<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt"></label>
${custom}${questions.length ? `<fieldset><legend>${m('questions')}</legend>${questionFields(questions, values, copy)}</fieldset>` : ''}
<label>${m('coverNote')}<textarea name="coverNote" rows="5" maxlength="8000">${esc(values.coverNote)}</textarea></label>
<label>${m('accommodation')}<textarea name="accommodation" rows="3" maxlength="4000">${esc(values.accommodation)}</textarea></label>
<fieldset><legend>${m('monitoring')}</legend><p>${esc(tr.monitoring)}</p><p>${m('monitoringHelp')}</p><label>${m('answer')}<select name="monitoring">${MONITORING_OPTIONS.map((o, i) => `<option value="${esc(o)}"${values.monitoring === o ? ' selected' : ''}>${esc(tr.monitoringOptions[i])}</option>`).join('')}</select></label></fieldset>
<details><summary>${m('notice', { version: notice.version })}</summary>${paragraphs(tr.notice)}</details><input type="hidden" name="noticeVersion" value="${esc(notice.version)}">${california}
<label><input type="checkbox" name="consent" value="yes" required> ${m(cpra ? 'consentCalifornia' : 'consent', { version: notice.version, californiaVersion: cpra?.version })}</label>
<label><input type="checkbox" name="talentPool" value="yes"${values.talentPool === 'yes' ? ' checked' : ''}> ${m('talentPool')}</label>
<button type="submit">${m('submit')}</button></form>${draftTools(copy)}`
}

export function translatedReceipt(receipt: Data, contact: string, timeZone: string, language: string,
  copy?: Record<string, string>) {
  if (!copy && language === 'es') copy = SPANISH
  requireThat(copy, 'Missing translated receipt interface', 409)
  const m = (key: string, substitutions: Data = {}) => message(copy, key, substitutions)
  requireThat(Intl.DateTimeFormat.supportedLocalesOf([language]).length === 1, 'Receipt date language is unavailable', 409)
  const formatter = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' })
  const date = new Date(receipt.submittedAt), time = language === 'en' ? times(timeZone).stamped(receipt.submittedAt) : formatter.format(date)
  const zone = formatter.formatToParts(date).find(part => part.type === 'timeZoneName')?.value
  return `<h1>${m('received')}</h1><p>${m('thanks')}</p><dl><dt>${m('receipt')}</dt><dd>${esc(receipt.id)}</dd><dt>${m('job')}</dt><dd>${esc(receipt.vacancyTitle)}</dd><dt>${m('receivedAt')}</dt><dd><time datetime="${esc(receipt.submittedAt)}">${m('receiptTime', { time, zone })}</time></dd><dt>${m('privacyNotice')}</dt><dd>${m('version', { version: receipt.noticeVersion })}</dd>${receipt.cpraNoticeVersion ? `<dt>${m('californiaPrivacyNotice')}</dt><dd>${m('version', { version: receipt.cpraNoticeVersion })}</dd>` : ''}</dl><p>${m('receiptHelp', { contact })}</p>`
}
