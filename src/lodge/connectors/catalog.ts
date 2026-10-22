/** Registry capabilities, not assertions about an employer's provider account. */
export const CONNECTORS = [
  { id: 'installation-mail', name: 'Installation mail', scopes: ['transactional-mail'], bindings: ['MAIL_API_KEY'], fields: ['recipient', 'subject', 'text'], adapter: 'existing', note: 'Uses the installation mail adapter selected in setup. Registration does not change mail setup or prove provider access.' },
  { id: 'sendgrid', name: 'SendGrid', scopes: ['mail.send'], bindings: ['MAIL_API_KEY'], fields: ['recipient', 'subject', 'text'], adapter: 'existing', note: 'SendGrid is supported by installation mail when selected in setup. This registry does not select or connect the account.' },
  { id: 'google-calendar', name: 'Google Calendar', scopes: ['calendar.events'], bindings: ['GOOGLE_CALENDAR_REFRESH_TOKEN'], fields: ['title', 'startsAt', 'endsAt', 'organizer'], adapter: 'unavailable', note: 'Calendar adapter unavailable; no events are created or synchronized.' },
  { id: 'docusign', name: 'DocuSign', scopes: ['signature'], bindings: ['DOCUSIGN_ACCESS_TOKEN'], fields: ['document', 'signer', 'status'], adapter: 'unavailable', note: 'DocuSign adapter unavailable; native Lodge signing is a separate workflow.' },
  { id: 'bamboohr', name: 'BambooHR', scopes: ['employee-write'], bindings: ['BAMBOOHR_API_KEY'], fields: ['name', 'email', 'startDate', 'jobTitle'], adapter: 'unavailable', note: 'HRIS adapter unavailable; registration creates no employee.' },
  { id: 'gusto', name: 'Gusto', scopes: ['employee-write'], bindings: ['GUSTO_ACCESS_TOKEN'], fields: ['name', 'email', 'startDate', 'jobTitle'], adapter: 'unavailable', note: 'HRIS adapter unavailable; registration creates no employee or payroll record.' },
] as const

export function connectorDefinition(id: unknown) { return CONNECTORS.find(p => p.id === id) }
