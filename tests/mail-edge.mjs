// Test-only network edge: production validation and provider serialization run
// normally; only the provider request and its response are controlled here.
import { createMailSender } from '../src/modules/mail/index.mjs'
export function operatorMail(env) {
 const provider = env.MAIL_PROVIDER === 'sendgrid' ? 'sendgrid' : 'resend'
 return createMailSender({ provider, mode: 'production', apiKey: 'synthetic-lodge-1' }, {
  async fetch(url, init) {
   const endpoint = provider === 'sendgrid' ? 'https://api.sendgrid.com/v3/mail/send' : 'https://api.resend.com/emails'
   if (url !== endpoint || init.method !== 'POST') throw Error('Unexpected mail provider request')
   const wire = JSON.parse(init.body)
   const message = provider === 'sendgrid' ? { from: wire.from.email, replyTo: wire.reply_to?.email, to: wire.personalizations[0].to.map(x => x.email), subject: wire.subject, text: wire.content.find(c => c.type === 'text/plain')?.value } : wire
   await env.DB.prepare('INSERT INTO rer_mail_development_outbox(id,created_at,message) VALUES(?,?,?)').bind(crypto.randomUUID(), Date.now(), JSON.stringify(message)).run()
   const id = crypto.randomUUID()
   return provider === 'sendgrid' ? new Response(null, { status: 202, headers: { 'x-message-id': id } }) : Response.json({ id })
  },
 })
}
