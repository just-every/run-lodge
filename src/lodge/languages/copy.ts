import { amount } from '../core/labels'
import { requireThat, type Data } from '../core/types'

export const SPANISH: Record<string, string> = {
  language: 'Idioma', back: 'Todos los puestos',
  optional: ' (opcional)', yes: 'Sí', no: 'No', choose: 'Elija…',
  payYear: 'al año', payMonth: 'al mes', payHour: 'por hora',
  onsite: 'Presencial', hybrid: 'Híbrido', remote: 'Remoto',
  fullTime: 'Tiempo completo', partTime: 'Tiempo parcial', contract: 'Contrato', temporary: 'Temporal',
  salary: 'Salario: {pay}',
  restrictedHelp: 'Solo los administradores de contratación pueden leer esta respuesta.',
  californiaNotice: 'Aviso de privacidad de California (versión {version})',
  californiaRequest: 'Puede solicitar acceso, corrección o eliminación de sus datos en {privacyPath}.',
  refusal: 'No se envió la solicitud. Revise los campos obligatorios y el aviso de privacidad vigente. Vuelva a cargar esta página si el aviso cambió.',
  apply: 'Solicitar el puesto', name: 'Nombre completo', email: 'Correo electrónico',
  phone: 'Teléfono (opcional)', location: 'Lugar de residencia (opcional)',
  resume: 'Currículum (opcional, PDF, Word o texto, hasta 1 MB)', questions: 'Preguntas del empleador',
  coverNote: 'Carta de presentación (opcional)', accommodation: 'Adaptaciones que necesita (opcional)',
  monitoring: 'Pregunta voluntaria de igualdad de oportunidades (opcional)',
  monitoringHelp: 'Su respuesta se guarda por separado y nunca se muestra a quienes evalúan su solicitud.',
  answer: 'Respuesta', notice: 'Aviso de privacidad (versión {version})',
  consent: 'He leído el aviso de privacidad versión {version}.',
  consentCalifornia: 'He leído el aviso de privacidad versión {version} y el aviso de California versión {californiaVersion}.',
  talentPool: 'Pueden contactarme sobre otros puestos adecuados mientras conserven mis datos.', submit: 'Enviar solicitud',
  received: 'Solicitud recibida', thanks: 'Gracias. Guarde este comprobante.', receipt: 'Comprobante',
  job: 'Puesto', receivedAt: 'Fecha de recepción', privacyNotice: 'Aviso de privacidad',
  version: 'Versión {version}', californiaPrivacyNotice: 'Aviso de California',
  receiptTime: '{time}',
  receiptHelp: 'Para solicitar adaptaciones, contacte a {contact} e indique su comprobante. Para ver, corregir o eliminar sus datos, use {privacyPath} con este comprobante y su correo electrónico.',
  signInvitationSubject: "{businessName} le envió una oferta para firmar electrónicamente",
  signInvitationText: "{businessName} le envió una oferta para firma electrónica.\n\nAbra este enlace: {link}\n\nSe le pedirá un código de un solo uso, enviado por correo por separado. El enlace vence el {expiresAt}.\n\nEste correo no contiene los términos de la oferta. ¿Tiene preguntas? Contacte a {contactName} en {contactEmail}.\n",
  signCodeSubject: "Su código de un solo uso para {businessName}",
  signCodeText: "Su código de un solo uso es {code}\n\nSirve para {purpose} durante 10 minutos. Si no lo solicitó, ignore este correo.\n",
  signPurpose: "la página de firma de su oferta",
  copyPurpose: "su copia firmada",
  signVoidSubject: "{businessName}: esta solicitud de firma ya no está activa",
  signVoidText: "Esta solicitud de firma ya no está activa. Contacte a {contactName} en {contactEmail}.\n",
  signCopySubject: "{businessName}: su copia de la oferta firmada",
  signCopyText: "Su oferta está firmada. Abra su copia aquí: {link}\n\nSe le pedirá un nuevo código de un solo uso, enviado por correo.\nEste correo no contiene los términos de la oferta. Contacte a {contactName} en {contactEmail}.\n",
}

/** Employer-facing source labels and placeholder contract for every scaffold field. */
export const SOURCE_UI: Record<string, string> = {
  language: 'Language', back: 'All open roles',
  optional: ' (optional)', yes: 'Yes', no: 'No', choose: 'Choose…',
  payYear: 'a year', payMonth: 'a month', payHour: 'an hour',
  onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote',
  fullTime: 'Full-time', partTime: 'Part-time', contract: 'Contract', temporary: 'Temporary',
  salary: 'Salary: {pay}', restrictedHelp: 'Only hiring administrators can read this answer.',
  californiaNotice: 'California privacy notice (version {version})',
  californiaRequest: 'You can request access, correction or deletion of your data at {privacyPath}.',
  refusal: 'Your application was not submitted. Check the required fields and current privacy notice. Reload this page if the notice changed.',
  apply: 'Apply for this role', name: 'Full name', email: 'Email', phone: 'Phone (optional)', location: 'Location (optional)',
  resume: 'Resume (optional, PDF, Word or text, up to 1 MB)', questions: 'Questions from the employer',
  coverNote: 'Cover note (optional)', accommodation: 'Accommodations you need (optional)',
  monitoring: 'Voluntary equal opportunities question (optional)',
  monitoringHelp: 'Your answer is stored separately and never shown to the people assessing your application.',
  answer: 'Answer', notice: 'Privacy notice (version {version})',
  consent: 'I have read privacy notice version {version}.',
  consentCalifornia: 'I have read privacy notice version {version} and California notice version {californiaVersion}.',
  talentPool: 'You may contact me about other suitable roles while you retain my data.', submit: 'Submit application',
  received: 'Application received', thanks: 'Thank you. Keep this receipt.', receipt: 'Receipt', job: 'Role',
  receivedAt: 'Received at', privacyNotice: 'Privacy notice', version: 'Version {version}',
  californiaPrivacyNotice: 'California notice', receiptTime: '{time}',
  receiptHelp: 'For accommodations, contact {contact} and quote your receipt. To view, correct or delete your data, use {privacyPath} with this receipt and your email address.',
  signInvitationSubject: "{businessName} sent you an offer to sign electronically",
  signInvitationText: "{businessName} has sent you an offer for electronic signature.\n\nOpen this link: {link}\n\nYou will be asked for a one-time code, which is emailed separately. The link expires {expiresAt}.\n\nThis email carries no offer terms. Questions? Contact {contactName} at {contactEmail}.\n",
  signCodeSubject: "Your one-time code for {businessName}",
  signCodeText: "Your one-time code is {code}\n\nIt works for {purpose} for 10 minutes. If you did not ask for it, ignore this email.\n",
  signPurpose: "your offer signing page",
  copyPurpose: "your signed copy",
  signVoidSubject: "{businessName}: this signing request is no longer active",
  signVoidText: "This signing request is no longer active. Contact {contactName} at {contactEmail}.\n",
  signCopySubject: "{businessName}: your signed offer copy",
  signCopyText: "Your offer is signed. Open your copy here: {link}\n\nYou will be asked for a fresh one-time code, emailed to you.\nThis email carries no offer terms. Questions? Contact {contactName} at {contactEmail}.\n",
}

export const UI_KEYS = Object.keys(SPANISH)

/** Custom languages must supply their own complete reviewed scaffold. */
export function uiCopy(post: Data): Record<string, string> {
  if (post.language === 'es') return SPANISH
  const copy = post.translation?.ui
  requireThat(copy && typeof copy === 'object' && !Array.isArray(copy), 'Missing translated application interface', 409)
  for (const key of UI_KEYS) requireThat(typeof copy[key] === 'string' && copy[key].trim(), 'Missing translated application interface: ' + key, 409)
  return copy
}


export function translatedPay(c: Data, copy: Record<string, string>) {
  const key = ({ year: 'payYear', month: 'payMonth', hour: 'payHour' } as Record<string, string>)[c.period]
  requireThat(key && copy[key], 'Missing translated pay period', 409)
  return `${amount(c.min, c.currency)}–${amount(c.max, c.currency)} ${copy[key]}`
}
