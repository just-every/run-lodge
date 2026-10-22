import type { Data } from '../core/types'
import { schemaOf } from '../fields/schema'
import { MONITORING_OPTIONS } from '../records/intake'
import { amount } from '../core/labels'

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const paragraphs = (v: string) => esc(v).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')

/** Spanish scaffold; employer-authored text always comes from its reviewed version. */
export function spanishForm(v: Data, business: Data, error: string, values: Data, questions: Data[], action: string, hidden: Record<string, string>, cpra: Data | null, questionFields: (q: Data[], v: Data, es?: boolean) => string) {
  const tr = v.translation, notice = business.notices.at(-1)
  const field = (name: string, label: string, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(values[name])}" ${extra}></label>`
  const c = v.compensation
  const pay = c ? `${amount(c.min, c.currency)}–${amount(c.max, c.currency)} ${{ year: 'al año', month: 'al mes', hour: 'por hora' }[c.period as string] ?? c.period}` : ''
  const facts = [v.location, ({ onsite: 'Presencial', hybrid: 'Híbrido', remote: 'Remoto' } as Data)[v.workMode], ({ 'full-time': 'Tiempo completo', 'part-time': 'Tiempo parcial', contract: 'Contrato', temporary: 'Temporal' } as Data)[v.employmentType]].filter(Boolean).join(' · ')
  const custom = schemaOf(v).filter(f => f.record !== 'vacancy').map(f => {
    const q = tr.fields[f.id], name = 'cf-' + f.id, req = f.requiredStages.includes(v.stages[0]?.id) ? ' required' : '', label = esc(q.name) + (req ? '' : ' (opcional)')
    const help = f.restricted ? '<small>Solo los administradores de contratación pueden leer esta respuesta.</small>' : ''
    if (f.type === 'choice' || f.type === 'boolean') {
      const options = f.type === 'boolean' ? [['true', 'Sí'], ['false', 'No']] : f.choices.map((o, i) => [o, q.choices[i]])
      return `<label>${label}${help}<select name="${name}"${req}><option value="">Elija…</option>${options.map(([value, title]) => `<option value="${esc(value)}"${values[name] === value ? ' selected' : ''}>${esc(title)}</option>`).join('')}</select></label>`
    }
    return `<label>${label}${help}<input name="${name}" type="${f.type === 'text' ? 'text' : f.type}" value="${esc(values[name])}"${req}></label>`
  }).join('')
  const california = cpra ? `<details><summary>Aviso de privacidad de California (versión ${esc(cpra.version)})</summary>${paragraphs(tr.cpra.intro || '')}<dl>${tr.cpra.categories.map((c: Data) => `<dt>${esc(c.category)}</dt><dd>${esc(c.collected)} ${esc(c.purposes)} ${esc(c.retention)}</dd>`).join('')}</dl><p>${esc(tr.cpra.saleStatement)}</p><p>Puede solicitar acceso, corrección o eliminación de sus datos en <a href="/privacy-requests">/privacy-requests</a>.</p></details><input type="hidden" name="cpraNoticeVersion" value="${esc(cpra.version)}">` : ''
  return `<h1>${esc(v.title)}</h1><p class="meta">${esc(facts)}${pay ? `<br>Salario: ${esc(pay)}` : ''}</p>${paragraphs(v.description || '')}
${error ? '<p role="alert" class="error">No se envió la solicitud. Revise los campos obligatorios y el aviso de privacidad vigente. Vuelva a cargar esta página si el aviso cambió.</p>' : ''}
<h2>Solicitar el puesto</h2><p>${esc(tr.accommodation)} ${esc(business.accommodationContact)}</p>
<form method="post" enctype="multipart/form-data" action="${esc(action)}">
${Object.entries(hidden).map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`).join('')}
${field('name', 'Nombre completo', 'text', 'required autocomplete="name" maxlength="160"')}
${field('email', 'Correo electrónico', 'email', 'required autocomplete="email"')}
${field('phone', 'Teléfono (opcional)', 'tel', 'autocomplete="tel"')}
${field('location', 'Lugar de residencia (opcional)', 'text', 'autocomplete="address-level2"')}
<label>Currículum (opcional, PDF, Word o texto, hasta 1 MB)<input name="resume" type="file" accept=".pdf,.doc,.docx,.txt,.rtf,.odt"></label>
${custom}${questions.length ? `<fieldset><legend>Preguntas del empleador</legend>${questionFields(questions, values, true)}</fieldset>` : ''}
<label>Carta de presentación (opcional)<textarea name="coverNote" rows="5" maxlength="8000">${esc(values.coverNote)}</textarea></label>
<label>Adaptaciones que necesita (opcional)<textarea name="accommodation" rows="3" maxlength="4000">${esc(values.accommodation)}</textarea></label>
<fieldset><legend>Pregunta voluntaria de igualdad de oportunidades (opcional)</legend><p>${esc(tr.monitoring)}</p><p>Su respuesta se guarda por separado y nunca se muestra a quienes evalúan su solicitud.</p><label>Respuesta<select name="monitoring">${MONITORING_OPTIONS.map((o, i) => `<option value="${esc(o)}"${values.monitoring === o ? ' selected' : ''}>${esc(tr.monitoringOptions[i])}</option>`).join('')}</select></label></fieldset>
<details><summary>Aviso de privacidad (versión ${esc(notice.version)})</summary>${paragraphs(tr.notice)}</details><input type="hidden" name="noticeVersion" value="${esc(notice.version)}">${california}
<label><input type="checkbox" name="consent" value="yes" required> He leído el aviso de privacidad versión ${esc(notice.version)}${cpra ? ` y el aviso de California versión ${esc(cpra.version)}` : ''}.</label>
<label><input type="checkbox" name="talentPool" value="yes"${values.talentPool === 'yes' ? ' checked' : ''}> Pueden contactarme sobre otros puestos adecuados mientras conserven mis datos.</label>
<button type="submit">Enviar solicitud</button></form>`
}

export function spanishReceipt(receipt: Data, contact: string, timeZone: string) {
  const received = new Intl.DateTimeFormat('es-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(receipt.submittedAt)) + ' (' + timeZone + ')'
  return `<h1>Solicitud recibida</h1><p>Gracias. Guarde este comprobante.</p><dl><dt>Comprobante</dt><dd>${esc(receipt.id)}</dd><dt>Puesto</dt><dd>${esc(receipt.vacancyTitle)}</dd><dt>Fecha de recepción</dt><dd><time datetime="${esc(receipt.submittedAt)}">${esc(received)}</time></dd><dt>Aviso de privacidad</dt><dd>Versión ${esc(receipt.noticeVersion)}</dd>${receipt.cpraNoticeVersion ? `<dt>Aviso de California</dt><dd>Versión ${esc(receipt.cpraNoticeVersion)}</dd>` : ''}</dl><p>Para solicitar adaptaciones, contacte a ${esc(contact)} e indique su comprobante. Para ver, corregir o eliminar sus datos, use <a href="/privacy-requests">/privacy-requests</a> con este comprobante y su correo electrónico.</p>`
}
