import { statusTiming, timingLabel, statusDue, dueLabel, TIMING_RULE } from '../communications/timing'
import { now } from '../core/types'
import { canSeeApplication, canSeeContact } from '../core/access'
import { applicationEmailContent } from '../communications/content'
import type { State } from '../core/state'
import type { Actor, Data } from '../core/types'
import { esc } from './public'

export function applicationEmailPreview(s: State, a: Actor, job: Data, draft: Data, preview: boolean) {
  const applications = s.all('application').filter(app => app.vacancy === job.id && canSeeApplication(s, a, app) && canSeeContact(s, a, s.get('candidate', app.candidate)))
  const picker = `<label>Preview recipient<select name="previewApplication" aria-label="Preview recipient"><option value="">Choose an existing application</option>${applications.map(app => `<option value="${esc(app.id)}"${draft.previewApplication === app.id ? ' selected' : ''}>${esc(s.get('candidate', app.candidate).name)}</option>`).join('')}</select></label>`
  if (!preview) return picker
  const app = applications.find(app => app.id === draft.previewApplication)
  const footer = draft.footer || (draft.language === 'en' ? s.find('application-email-transport', 'main')?.footer : '') || ''
  const content = app ? applicationEmailContent(s, app, draft, s.all('receipt').find(receipt => receipt.application === app.id)?.id ?? '', footer) : { to: '', subject: draft.subject, text: draft.body + '\n\n' + footer, missing: ['recipient application'] }
  if (!footer) content.missing.push('reviewed footer')
  const transport = s.find('application-email-transport', 'main')
  return `${picker}<section aria-label="Exact template preview"><h3>Exact template preview</h3><dl><dt>Recipient</dt><dd>${esc(content.to || 'Choose an application')}</dd><dt>Sender</dt><dd>${esc(transport?.from || 'Sender review required')}</dd><dt>Reply to</dt><dd>${esc(transport?.replyTo || 'Reply route review required')}</dd><dt>Timing</dt><dd>${draft.kind === 'status' ? timingLabel(statusTiming(job)) + '. ' + TIMING_RULE + ' Example event now is due ' + dueLabel(statusDue(statusTiming(job), now()), statusTiming(job)) : 'Immediately after accepted intake'}</dd></dl>${content.missing.length ? `<p role="alert">Missing values: ${esc(content.missing.join(', '))}. Sending is blocked until these values exist.</p>` : ''}<p>Subject</p><div class="sign-doc">${esc(content.subject)}</div><p>Body and required footer</p><div class="sign-doc">${esc(content.text)}</div></section>`
}
