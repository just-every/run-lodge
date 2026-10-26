import { identityFetch } from './audit'
import { createOperatorAuth, type IdentityProviderConfig } from '../../modules/operator-auth/index.mjs'
import { authConfig, runtimeBindings, type Bindings } from '../../auth.server'
import { operatorMail } from '../../mail.server.mjs'
import { load } from '../core/store'

export const providerId = 'lodge-okta'
export function oidcConfigured(env: Bindings) {
  return !!(env.ENTERPRISE_OKTA_ISSUER && env.ENTERPRISE_OKTA_CLIENT_ID && env.ENTERPRISE_OKTA_CLIENT_SECRET && (env.ENTERPRISE_OIDC_SECRET?.length ?? 0) >= 32)
}
export function samlConfigured(env: Bindings) {
  return !!(env.ENTERPRISE_OKTA_ISSUER && env.ENTERPRISE_SAML_ISSUER && env.ENTERPRISE_SAML_ENTRY_POINT && env.ENTERPRISE_SAML_CERTIFICATE)
}
export function configured(env: Bindings) {
  return (env.ENTERPRISE_SCIM_TOKEN?.length ?? 0) >= 32 && (oidcConfigured(env) || samlConfigured(env))
}

/** Associations are written only by the authenticated provisioning door, never token email. */
export async function enterpriseAuth(original: Bindings) {
  const env = runtimeBindings(original), s = await load(env.DB)
  const issuer = env.ENTERPRISE_OKTA_ISSUER!, subjectEmails: Record<string, string> = {}
  for (const member of s.all('member')) if (member.active && member.enterprise?.issuer === issuer) subjectEmails[member.enterprise.subject] = member.email
  const provider: IdentityProviderConfig = { id: providerId, preset: 'okta', label: 'Employer Okta', issuer, clientId: env.ENTERPRISE_OKTA_CLIENT_ID!, tokenAuthMethod: 'client_secret_basic', clientSecret: env.ENTERPRISE_OKTA_CLIENT_SECRET!, subjectEmails }
  return createOperatorAuth({ db: env.DB, fetch: identityFetch(env), config: { ...authConfig(env), providers: [provider], OIDC_TRANSACTION_SECRET: env.ENTERPRISE_OIDC_SECRET }, mailSender: operatorMail(env), clientIp: request => request.headers.get('CF-Connecting-IP') ?? '', hooks: {
    async afterConfirm({ operator }) {
      const current = await load(env.DB), member = current.find('member', operator.email)
      if (!member?.active || member.enterprise?.issuer !== issuer) throw new Error('Enterprise membership required')
    },
  } })
}
