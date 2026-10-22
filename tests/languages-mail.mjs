import assert from 'node:assert/strict'

/** Every candidate-mail door currently shipped: invitation, code, void, completion and copy code. */
export async function checkLanguageMail(h, app, job) {
  const cmd = h.command, address = 'lucia@example.test'
  const template = await cmd('offer-template', { name: 'Warehouse offer', body: '{{candidateName}}: {{title}}. {{pay}}. {{startDate}}.', normalApprover: 'owner@example.test', exceptionApprover: 'owner@example.test', reviewed: true, native: true })
  await cmd('job-offer-template', { id: job.id, offerTemplate: { id: template.id, version: 1 } })
  const current = (await h.state()).vacancies.find(v => v.id === job.id)
  const offer = await cmd('offer', { application: app.id, title: 'Asociado de almacén', startDate: '2027-04-01', salary: { currency: 'USD', amount: 4500000, period: 'year' }, opening: current.openings[0].id })
  const approval = await cmd('request-offer-approval', { id: offer.id, approver: 'owner@example.test' })
  const version = (await h.state()).approvals.find(a => a.id === approval.id).currentVersion
  await cmd('decide-approval', { id: approval.id, decision: 'approved', version, reason: 'Reviewed' })
  await cmd('esign-disclosure', { reviewed: true, contactName: 'Equipo de contratación', contactEmail: 'hiring@example.test' })
  const mails = async () => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message)).filter(m => m.to.includes(address))
  const form = fields => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f }
  const send = () => h.send('/api/lodge/esign/send', { offer: offer.id }, h.owner)
  assert.equal((await send()).status, 200)
  let invitation = (await mails()).at(-1)
  assert.match(invitation.subject, /le envió una oferta/)
  const firstEnvelope = (await h.state()).offers.find(o => o.id === offer.id).esign
  await cmd('esign-void', { id: firstEnvelope.id, reason: 'Reviewed replacement requested' })
  assert.match((await mails()).at(-1).subject, /ya no está activa/)
  assert.equal((await send()).status, 200)
  invitation = (await mails()).at(-1)
  const path = new URL(invitation.text.match(/http:\/\/\S+\/sign\/\S+/)[0]).pathname
  assert.equal((await h.send(path + '/code', form({}))).status, 200)
  const codeMail = (await mails()).at(-1)
  assert.match(codeMail.subject, /Su código de un solo uso/)
  const verified = await h.send(path + '/verify', form({ code: codeMail.text.match(/\b\d{6}\b/)[0] }))
  assert.equal(verified.status, 303)
  assert.equal((await h.send(path + '/agree', form({ version: '1', box: 'yes' }), verified.cookie)).status, 303)
  assert.equal((await h.send(path + '/sign', form({ name: 'Lucía Torres', hash: offer.document.sha256 }), verified.cookie)).status, 303)
  const complete = (await mails()).at(-1)
  assert.match(complete.subject, /su copia de la oferta firmada/)
  assert.ok(!/This email|one-time code|sent you an offer/.test((await mails()).map(m => m.text).join('\n')), 'current candidate emails carry no English scaffold')
  const copy = new URL(complete.text.match(/http:\/\/\S+\/copy\/\S+/)[0]).pathname
  assert.equal((await h.send(copy + '/code', form({}))).status, 200)
  assert.match((await mails()).at(-1).text, /su copia firmada/)
}
