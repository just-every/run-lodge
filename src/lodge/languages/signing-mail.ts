import type { Data } from '../core/types'

const contact = (e: Data) => `¿Tiene preguntas? Contacte a ${e.contact.name} en ${e.contact.email}.`

/** Transactional candidate mail already shipped by OFFER-005 follows the application's chosen language. */
export const spanishInvitation = (e: Data, origin: string, token: string) => ({
  subject: `${e.businessName} le envió una oferta para firmar electrónicamente`,
  text: `${e.businessName} le envió una oferta para firma electrónica.\n\nAbra este enlace: ${origin}/sign/${token}\n\nSe le pedirá un código de un solo uso, enviado por correo por separado. El enlace vence el ${e.expiresAt}.\n\nEste correo no contiene los términos de la oferta. ${contact(e)}\n`,
})
export const spanishCode = (e: Data, code: string, purpose: 'sign' | 'copy') => ({
  subject: `Su código de un solo uso para ${e.businessName}`,
  text: `Su código de un solo uso es ${code}\n\nSirve para ${purpose === 'sign' ? 'la página de firma de su oferta' : 'su copia firmada'} durante 10 minutos. Si no lo solicitó, ignore este correo.\n`,
})
export const spanishNotice = (n: Data, origin: string) => n.kind === 'void'
  ? { subject: `${n.businessName}: esta solicitud de firma ya no está activa`, text: `Esta solicitud de firma ya no está activa. ${contact(n)}\n` }
  : { subject: `${n.businessName}: su copia de la oferta firmada`, text: `Su oferta está firmada. Abra su copia aquí: ${origin}/copy/${n.copyToken}\n\nSe le pedirá un nuevo código de un solo uso, enviado por correo.\nEste correo no contiene los términos de la oferta. ${contact(n)}\n` }
