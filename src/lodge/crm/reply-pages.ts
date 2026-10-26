import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { load, save, signedIn } from '../core/store'
import { Fault, now, requireThat, text, uid } from '../core/types'
import { esc, formBody, page, sameOrigin } from '../http/public'
import { stopCandidateNurture } from './inbound'

export const crmReplyPages = new Hono<{ Bindings: Bindings }>()
crmReplyPages.use('*', async (c, next) => { await next(); c.header('cache-control', 'no-store'); c.header('referrer-policy', 'same-origin') })
crmReplyPages.onError(error => page('Candidate conversation', `<h1>Candidate conversation</h1><p role="alert">${esc(error instanceof Fault ? error.message : 'Please try again later.')}</p>`, error instanceof Fault ? error.status : 500))
async function conversation(c: Context<{ Bindings: Bindings }>) {
  const session = await signedIn(c.req.raw, c.env), s = await load(c.env.DB), e = s.find('crm-enrollment', c.req.param('id')), person = e && s.find('candidate', e.candidate)
  requireThat(e && person && !person.deleted && !person.mergedInto && person.email?.toLowerCase() === session.operator.email.toLowerCase(), 'Conversation not found', 404)
  return { s, e, person, session }
}
crmReplyPages.get('/crm/reply/:id', async c => {
  const { s, e, person } = await conversation(c)
  const sent = s.all('application-email').filter(m => m.enrollment === e.id && ['handed', 'delivered'].includes(m.status))
  const replies = s.all('crm-reply').filter(r => r.candidate === person.id && r.enrollments?.includes(e.id))
  return page('Candidate conversation', `<h1>Your recruiting conversation</h1><p>Replying stops further messages in the current nurture sequence. Your reply does not apply to a job or change a hiring decision.</p>${sent.map(m => `<article><h2>${esc(m.content.subject)}</h2><div class="sign-doc">${esc(m.content.text)}</div></article>`).join('')}${replies.map(r => `<article><h2>Your reply</h2><div class="sign-doc">${esc(r.body)}</div></article>`).join('')}<form method="post"><label>Your reply<textarea name="body" rows="6" maxlength="5000" required></textarea></label><button>Send reply and stop sequence</button></form><p><a href="/crm/opt-out/${esc(e.optOutToken)}">Stop contact about future openings</a></p>`)
})
crmReplyPages.post('/crm/reply/:id', async c => {
  await sameOrigin(c)
  const { s, e, person, session } = await conversation(c), body = text((await formBody(c)).get('body'), 'Reply', 5000)
  s.put('crm-reply', uid(), { candidate: person.id, application: e.sourceApplication, enrollments: [e.id], source: 'native-candidate-account', subject: 'Candidate reply', body, receivedAt: now(), actor: session.operator.id })
  stopCandidateNurture(s, person.id, 'Candidate replied')
  s.audit(null, 'nurture-account-reply-received', 'candidate:' + person.id)
  await save(c.env.DB, s, null)
  return c.redirect('/crm/reply/' + encodeURIComponent(e.id), 303)
})
