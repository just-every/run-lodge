import { createMailSender } from './modules/mail/index.mjs'

export function operatorMail(env) {
 if (env.RER_DEMO === '1' || (env.MAIL_PROVIDER === 'development' && env.AUTH_LOCAL === 'true')) return createMailSender({ provider: 'development', mode: 'development' })
 return env.MAIL_PROVIDER && env.MAIL_PROVIDER !== 'development' ? createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }) : undefined
}
