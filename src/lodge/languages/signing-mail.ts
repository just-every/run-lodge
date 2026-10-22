import { requireThat, type Data } from '../core/types'
import { SPANISH } from './copy'

const copyOf = (e: Data): Record<string, string> => e.language === 'es' ? SPANISH : e.languageUi
function words(e: Data, key: string, values: Data) {
  const template = copyOf(e)?.[key]
  requireThat(typeof template === 'string' && template.trim(), 'Missing reviewed candidate email text', 409)
  return template.replace(/\{([a-zA-Z]+)\}/g, (_: string, name: string) => {
    requireThat(Object.hasOwn(values, name), 'Missing candidate email value', 409)
    return String(values[name])
  })
}
const facts = (e: Data) => ({ businessName: e.businessName, contactName: e.contact.name, contactEmail: e.contact.email })
export const translatedInvitation = (e: Data, origin: string, token: string) => ({
  subject: words(e, 'signInvitationSubject', facts(e)), text: words(e, 'signInvitationText', { ...facts(e), link: `${origin}/sign/${token}`, expiresAt: e.expiresAt }),
})
export const translatedCode = (e: Data, code: string, purpose: 'sign' | 'copy') => ({
  subject: words(e, 'signCodeSubject', facts(e)), text: words(e, 'signCodeText', { ...facts(e), code, purpose: words(e, purpose === 'sign' ? 'signPurpose' : 'copyPurpose', {}) }),
})
export const translatedNotice = (n: Data, origin: string) => ({
  subject: words(n, n.kind === 'void' ? 'signVoidSubject' : 'signCopySubject', facts(n)), text: words(n, n.kind === 'void' ? 'signVoidText' : 'signCopyText', { ...facts(n), link: `${origin}/copy/${n.copyToken}` }),
})
