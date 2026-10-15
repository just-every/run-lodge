// Test-only network edge: production message validation and Resend serialization
// run normally; the provider request is recorded locally for confirmation flows.
import { createMailSender } from '../src/modules/mail/index.mjs'
export function operatorMail(env) {
 return createMailSender({ provider: 'resend', mode: 'production', apiKey: 'test-mail-provider-key' }, {
  async fetch(url, init) {
   if (url !== 'https://api.resend.com/emails' || init.method !== 'POST') throw Error('Unexpected mail provider request')
   const message = JSON.parse(init.body)
   await env.DB.prepare('INSERT INTO rer_mail_development_outbox(id,created_at,message) VALUES(?,?,?)').bind(crypto.randomUUID(), Date.now(), JSON.stringify(message)).run()
   return Response.json({ id: crypto.randomUUID() })
  },
 })
}
