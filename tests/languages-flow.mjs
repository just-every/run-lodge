import { FRENCH } from './language-fixtures.mjs'
import { checkLanguageMail } from './languages-mail.mjs'
import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'

export const spanishText = q => ({ reviewed: true, notice: 'Usamos su solicitud solo para evaluar su candidatura para este puesto y la conservamos durante un año.', accommodation: '¿Necesita una adaptación para solicitar el puesto o para la entrevista? Contacte al equipo o descríbala abajo. Solo los administradores pueden verla.', monitoring: '¿Cómo describe su género?', monitoringOptions: ['Prefiero no responder', 'Mujer', 'Hombre', 'No binario', 'Otra descripción'], questions: { [q.id]: { text: '¿Puede trabajar por la noche?', help: 'El turno empieza a las ocho.', options: ['Entre semana', 'Fin de semana'] } }, fields: {} })

export async function languageJob(cmd, approve, ownerEmail) {
  const office = await cmd('office', { name: 'Denver' })
  let job = await cmd('vacancy', { title: 'Warehouse Associate', headcount: 2, officeId: office.id, manager: ownerEmail, description: 'Load goods safely.', compensation: { currency: 'USD', min: 4200000, max: 4800000, period: 'year' } })
  await cmd('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe loading' }] })
  await cmd('interview-plan', { id: job.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
  const q = await cmd('question', { text: 'Can you work at night?', help: 'The shift begins at eight.', type: 'single-choice', options: ['Weekdays', 'Weekends'] })
  await cmd('job-questions', { id: job.id, questions: [{ question: q.id }] })
  const request = await cmd('request-vacancy-approval', { id: job.id, approver: ownerEmail })
  await approve(request)
  job = await cmd('publish', { id: job.id })
  const add = (language, title, description) => cmd('job-post', { vacancy: job.id, title, description, language, locations: [office.id], destinations: ['careers', 'embed', 'api'] })
  job = await add('en', 'Warehouse Associate', 'Load goods safely.')
  const en = job.posts.at(-1)
  await cmd('post-status', { vacancy: job.id, post: en.id, status: 'live' })
  job = await add('es', 'Asociado de almacén', 'Cargue mercancía de forma segura.')
  return { job, q, en, es: job.posts.at(-1), office }
}

export async function checkLanguages() {
  const h = await harness()
  try {
    const cmd = h.command
    await cmd('business', BUSINESS)
    const approve = async request => { const version = (await h.state()).approvals.find(a => a.id === request.id).currentVersion; await cmd('decide-approval', { id: request.id, decision: 'approved', reason: 'Budgeted', version }) }
    const { job, q, en, es } = await languageJob(cmd, approve, 'owner@example.test')
    await cmd('post-status', { vacancy: job.id, post: es.id, status: 'live' }, h.owner, 409)
    const tr = spanishText(q)
    await cmd('post-translation', { vacancy: job.id, post: es.id, translation: { ...tr, reviewed: false } })
    await cmd('post-status', { vacancy: job.id, post: es.id, status: 'live' }, h.owner, 409)
    await cmd('post-translation', { vacancy: job.id, post: es.id, translation: tr })
    await cmd('post-status', { vacancy: job.id, post: es.id, status: 'live' })
    assert.equal((await h.send('/jobs/' + en.slug)).status, 200)
    const form = await h.send('/jobs/' + es.slug)
    assert.equal(form.status, 200)
    assert.match(form.text, /<html lang="es"/)
    for (const text of ['Nombre completo', 'Enviar solicitud', tr.notice, tr.accommodation, '¿Puede trabajar por la noche?', 'Entre semana', 'Prefiero no responder']) assert.ok(form.text.includes(text), text)
    assert.ok(!form.text.includes('Can you work at night?') && !form.text.includes('Full name') && !form.text.includes('Voluntary equal-opportunity'))
    const values = () => { const f = new FormData(); for (const [k, v] of Object.entries({ name: 'Lucía Torres', email: 'lucia@example.test', noticeVersion: '1', consent: 'yes', monitoring: 'Woman', ['q-' + q.id]: 'Weekdays' })) f.append(k, v); return f }
    const invalid = values(); invalid.delete('consent')
    const refusal = await h.send('/jobs/' + es.slug, invalid)
    assert.equal(refusal.status, 400); assert.match(refusal.text, /No se envió la solicitud/); assert.match(refusal.text, /<html lang="es"/)
    const receipt = await h.send('/jobs/' + es.slug, values())
    assert.equal(receipt.status, 200, receipt.text); assert.match(receipt.text, /Solicitud recibida/); assert.match(receipt.text, /<html lang="es"/)
    const state = await h.state(), app = state.applications.find(a => a.candidateName === 'Lucía Torres')
    assert.deepEqual([app.language, app.answers[0].text, app.answers[0].sourceText, app.answers[0].value], ['es', '¿Puede trabajar por la noche?', 'Can you work at night?', 'Weekdays'])
    assert.equal(state.candidates.find(c => c.id === app.candidate).language, 'es')
    assert.equal(state.receipts.find(r => r.application === app.id).language, 'es')
    await cmd('job-board', { token: 'warehouse', allowedOrigins: [h.origin] })
    const detail = (await h.send('/api/board/v1/warehouse/jobs/' + es.id)).value
    assert.equal(detail.privacyNotice.text, tr.notice); assert.equal(detail.language, 'es'); assert.equal(detail.questions[0].optionLabels[0], 'Entre semana')
    const embedded = await h.send('/embed/jobs/' + es.slug)
    assert.equal(embedded.status, 200); assert.match(embedded.text, /<html lang="es"/); assert.match(embedded.text, /Enviar solicitud/)
    const apiReceipt = await h.send('/api/board/v1/warehouse/jobs/' + es.id + '/applications', { name: 'María Vidal', email: 'maria@example.test', noticeVersion: 1, consent: true, answers: { [q.id]: 'Weekends' } })
    assert.equal(apiReceipt.status, 201); assert.equal(apiReceipt.value.language, 'es'); assert.equal(apiReceipt.value.message, 'Solicitud recibida')
    await checkLanguageMail(h, app, job)
    // A further language uses the same review and publishing mechanism, with no source-language fallback.
    let frenchJob = await cmd('job-post', { vacancy: job.id, title: 'Agent d’entrepôt', description: 'Chargez les marchandises en toute sécurité.', language: 'fr', locations: [job.officeId], destinations: ['careers', 'embed', 'api'] })
    const fr = frenchJob.posts.at(-1)
    const french = { reviewed: true, notice: 'Nous utilisons votre candidature pour ce poste et la conservons un an.', accommodation: 'Pour demander un aménagement, contactez le service de recrutement ou décrivez-le ci-dessous. Seuls les administrateurs le consultent.', monitoring: 'Comment décrivez-vous votre genre ?', monitoringOptions: ['Je préfère ne pas répondre', 'Femme', 'Homme', 'Non binaire', 'Autre description'], questions: { [q.id]: { text: 'Pouvez-vous travailler la nuit ?', help: 'Le service commence à huit heures.', options: ['En semaine', 'Le week-end'] } }, fields: {}, ui: FRENCH }
    await cmd('post-translation', { vacancy: job.id, post: fr.id, translation: { ...french, ui: { ...FRENCH, submit: '' } } })
    await cmd('post-status', { vacancy: job.id, post: fr.id, status: 'live' }, h.owner, 409)
    await cmd('post-translation', { vacancy: job.id, post: fr.id, translation: { ...french, ui: { ...FRENCH, receiptHelp: 'Contactez le service.' } } })
    await cmd('post-status', { vacancy: job.id, post: fr.id, status: 'live' }, h.owner, 409)
    await cmd('post-translation', { vacancy: job.id, post: fr.id, translation: french })
    await cmd('post-status', { vacancy: job.id, post: fr.id, status: 'live' })
    const frenchPage = await h.send('/jobs/' + fr.slug)
    assert.equal(frenchPage.status, 200); assert.match(frenchPage.text, /<html lang="fr"/); assert.match(frenchPage.text, /Nom complet/); assert.match(frenchPage.text, /Envoyer la candidature/)
    const frenchForm = new FormData()
    for (const [k, v] of Object.entries({ name: 'Éloïse Martin', email: 'eloise@example.test', noticeVersion: '1', consent: 'yes', ['q-' + q.id]: 'Weekdays' })) frenchForm.set(k, v)
    const frenchReceipt = await h.send('/jobs/' + fr.slug, frenchForm)
    assert.equal(frenchReceipt.status, 200); assert.match(frenchReceipt.text, /Candidature reçue/)
    const frenchApp = (await h.state()).applications.find(a => a.candidateName === 'Éloïse Martin')
    assert.deepEqual([frenchApp.answers[0].text, frenchApp.answers[0].sourceText, frenchApp.language], ['Pouvez-vous travailler la nuit ?', 'Can you work at night?', 'fr'])
    await checkLanguageMail(h, frenchApp, job, { language: 'fr', address: 'eloise@example.test', name: 'Éloïse Martin' })
    await cmd('post-status', { vacancy: job.id, post: es.id, status: 'paused' })
    await cmd('post-translation', { vacancy: job.id, post: es.id, translation: { ...tr, questions: {} } })
    const missing = await cmd('post-status', { vacancy: job.id, post: es.id, status: 'live' }, h.owner, 409)
    assert.match(missing.error, /Missing es translation/)
    await cmd('post-translation', { vacancy: job.id, post: es.id, translation: tr })
    await cmd('post-status', { vacancy: job.id, post: es.id, status: 'live' })
    await cmd('question', { id: q.id, type: 'single-choice', text: 'Can you work the evening shift?', options: ['Weekdays', 'Weekends'] })
    assert.equal((await h.send('/jobs/' + es.slug)).status, 404, 'a source question edit makes Spanish unavailable rather than mixed')
    assert.equal((await h.send('/api/board/v1/warehouse/jobs/' + es.id)).status, 404)
    assert.equal((await h.send('/embed/jobs/' + es.slug)).status, 404)
    assert.equal((await h.send('/jobs/' + en.slug)).status, 200)
    assert.equal((await h.state()).applications.find(a => a.id === app.id).answers[0].sourceText, 'Can you work at night?', 'review keeps the exact answered source version')
  } finally { await h.close() }
}
