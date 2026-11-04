import { Hono, type Context } from 'hono'
import type { Bindings } from '../../auth.server'
import { can, requireApplication } from '../core/access'
import { actorFor, load, save, signedIn } from '../core/store'
import { candidateActor, ownReceipt } from '../candidate/access'
import { Fault, requireThat, uid } from '../core/types'
import { CHANNELS, canReviewChannels, changeChannelNumber, channelId, channelStatus, chooseChannel, reviewChannelNotice } from '../communications/channel-consent'
import { esc, formBody, page } from './public'

type C = Context<{ Bindings: Bindings }>
export const channelConsentPages = new Hono<{ Bindings: Bindings }>()
const path = (receipt: string) => '/candidate/receipts/' + encodeURIComponent(receipt) + '/channels'
const label = (channel: string) => channel === 'sms' ? 'SMS' : 'WhatsApp'
async function own(c: C) {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB), actor = candidateActor(session)
  requireThat(!state.find('member', actor.email)?.agent, 'Only the candidate can record channel choices', 403)
  const { receipt, candidate } = ownReceipt(state, actor.email, c.req.param('receipt') ?? '')
  return { state, actor, receipt, candidate, app: state.get('application', receipt.application) }
}
async function render(title: string, body: string, language = 'en') {
  const response = await page(title, body, 200, undefined, language)
  const html = (await response.text()).replace('</head>', '<link rel="stylesheet" href="/lodge-candidate.css"></head>').replace('class="lodge-public"', 'class="lodge-public candidate-area"')
  return new Response(html, { status: response.status, headers: response.headers })
}
async function input(c: C) {
  if (c.req.header('content-type')?.includes('application/json')) return c.req.json()
  return Object.fromEntries(await formBody(c))
}

channelConsentPages.get('/candidate/receipts/:receipt/channels', async c => {
  const { state, receipt, candidate, app } = await own(c)
  const blocks = CHANNELS.map(channel => {
    const profile = state.find('channel-number', channelId(candidate.id, channel)), number = profile?.versions.at(-1)
    const id = channelId(app.id, channel), notice = state.find('channel-notice', id), wording = notice?.versions.at(-1)
    const record = state.find('channel-consent', id), status = channelStatus(state, app, channel)
    const history = (record?.history ?? []).map((h: any) => `<li>${esc(h.at)}: ${esc(h.decision)}${h.number ? ' · ' + esc(h.number) + ' · ' + esc(h.zone) + ' · ' + esc(h.start) + '–' + esc(h.end) + ' · notice ' + esc(h.noticeVersion) + ' (' + esc(h.language) + '): ' + esc(h.purpose) + ' — ' + esc(h.noticeText) : ''}</li>`).join('')
    const hidden = `<input type="hidden" name="channel" value="${channel}"><input type="hidden" name="revision" value="${record?.history.length ?? 0}"><input type="hidden" name="request" value="${uid()}">`
    const available = wording && !notice?.restored && wording.language === (app.language ?? 'en') && number && !profile?.restored && app.status === 'active' && !app.candidateWithdrawnAt
    return `<section aria-label="${label(channel)} permission"><h2>${label(channel)}</h2><form method="post" action="${path(receipt.id)}/number"><input type="hidden" name="channel" value="${channel}"><input type="hidden" name="version" value="${profile?.versions.length ?? 0}"><label>Number with country code<input name="number" type="tel" required maxlength="16" placeholder="+15550102030" value="${esc(number?.number ?? '')}"></label><button type="submit">Save ${label(channel)} number</button></form><p role="status">${esc(status.reason)}</p>${wording ? `<h3>${esc(wording.purpose)}</h3><p>${esc(wording.text)}</p><p>Reviewed language: ${esc(wording.language)} · Notice version ${wording.version}</p>` : '<p>No employer-reviewed notice is available in your application language.</p>'}${available ? `<form method="post" action="${path(receipt.id)}/choice">${hidden}<input type="hidden" name="noticeVersion" value="${wording.version}"><input type="hidden" name="numberVersion" value="${number.version}"><p>Number: ${esc(number.number)} · Ownership unverified.</p><label>Time zone<input name="zone" required placeholder="e.g. UTC"></label><label>Daily contact window starts<input name="start" type="time" required></label><label>Daily contact window ends<input name="end" type="time" required></label><p>Windows use the local time in your chosen zone, including daylight-saving changes. Overnight windows are not supported.</p><fieldset><legend>Your ${label(channel)} choice</legend><label><input type="radio" name="decision" value="consent" required> I give permission for this channel and purpose.</label><label><input type="radio" name="decision" value="refuse" required> I refuse permission for this channel.</label></fieldset><button type="submit">Save ${label(channel)} choice</button></form>` : '<p>Fresh employer review and a number you enter are required before choosing.</p>'}<form method="post" action="${path(receipt.id)}/choice">${hidden}<input type="hidden" name="decision" value="withdraw"><button type="submit">Withdraw ${label(channel)} permission</button></form>${history ? '<details><summary>Choice history</summary><ul>' + history + '</ul></details>' : '<p>No channel choice recorded.</p>'}</section>`
  }).join('')
  return render('SMS and WhatsApp preferences', `<h1>SMS and WhatsApp preferences</h1><p>${esc(receipt.vacancyTitle)}</p><p>Each channel needs your separate explicit choice. A phone preference, talent-pool permission or employer-entered number does not give channel permission. Global no-contact and application withdrawal take priority.</p><p>These local records do not send messages or authorize a sender. Number ownership is unverified.</p><h2>Your channel numbers</h2><p>Enter a number separately for each channel. Changing a number requires a fresh choice for that channel.</p>${blocks}<p><a href="/candidate/receipts/${encodeURIComponent(receipt.id)}/account">Your application</a></p>`, app.language ?? 'en')
})
channelConsentPages.post('/candidate/receipts/:receipt/channels/:action', async c => {
  const { state, actor, receipt, candidate, app } = await own(c), b = await input(c)
  if (c.req.param('action') === 'number') changeChannelNumber(state, actor, candidate, b)
  else if (c.req.param('action') === 'choice') await chooseChannel(state, actor, candidate, app, b)
  else throw new Fault(404, 'Not available')
  await save(c.env.DB, state, actor)
  return c.redirect(path(receipt.id), 303)
})

async function staff(c: C) {
  const session = await signedIn(c.req.raw, c.env), state = await load(c.env.DB), actor = actorFor(session, state)
  const app = requireApplication(state, actor, c.req.param('application'))
  requireThat(canReviewChannels(state, actor, app), 'Channel records not found', 404)
  return { state, actor, app }
}
channelConsentPages.get('/candidate/employer/:application/channels', async c => {
  const { state, actor, app } = await staff(c), job = state.get('vacancy', app.vacancy)
  const editable = can(state, actor, job, 'settings')
  const sections = CHANNELS.map(channel => {
    const record = state.find('channel-notice', channelId(app.id, channel)), v = record?.versions.at(-1), choices = state.find('channel-consent', channelId(app.id, channel))
    return `<section aria-label="${label(channel)} review"><h2>${label(channel)}</h2><p>${esc(channelStatus(state, app, channel).reason)}</p>${editable ? `<form method="post"><input type="hidden" name="channel" value="${channel}"><input type="hidden" name="version" value="${record?.versions.length ?? 0}"><label>Application language<input name="language" required value="${esc(app.language ?? 'en')}"></label><label>Named purpose<input name="purpose" required maxlength="500" value="${esc(v?.purpose ?? '')}"></label><label>Channel notice<textarea name="text" required maxlength="5000">${esc(v?.text ?? '')}</textarea></label><label><input type="checkbox" name="reviewed" value="yes" required> Employer reviewed this purpose, notice and exact language.</label><button type="submit">Review ${label(channel)} notice</button></form>` : '<p>Job settings permission is required to change notices.</p>'}<h3>Immutable choice history</h3>${choices ? '<ul>' + choices.history.map((h: any) => `<li>${esc(h.at)}: ${esc(h.decision)} · ${esc(h.number ?? '')} · ${esc(h.zone ?? '')} ${esc(h.start ?? '')}–${esc(h.end ?? '')} · ${esc(h.purpose ?? '')} · ${esc(h.noticeText ?? '')} · Ownership unverified</li>`).join('') + '</ul>' : '<p>No explicit choice.</p>'}</section>`
  }).join('')
  return render('Channel consent settings', `<h1>Channel consent settings</h1><p>Review wording for this application’s language and named purpose. Edits require a fresh candidate choice. Local evidence supplies no sender authorization, number verification or provider approval.</p>${sections}<p><a href="/app?application=${encodeURIComponent(app.id)}">Back to Lodge</a></p>`)
})
channelConsentPages.post('/candidate/employer/:application/channels', async c => {
  const { state, actor, app } = await staff(c), b = await input(c)
  reviewChannelNotice(state, actor, { ...b, application: app.id, reviewed: b.reviewed === true || b.reviewed === 'yes' })
  await save(c.env.DB, state, actor)
  return c.redirect('/candidate/employer/' + encodeURIComponent(app.id) + '/channels', 303)
})
