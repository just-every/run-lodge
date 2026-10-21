// TEAM-002 and TEAM-003 through the public doors: the note, preference and scheduled-run commands and routes, the saved
// records, the home route and the mail network edge. Nothing in Lodge is faked; only the mail provider's edge is.
import assert from 'node:assert/strict'
import { BUSINESS, harness } from './harness.mjs'

const mails = async (h, to) => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence').all()).results.map(r => JSON.parse(r.message)).filter(m => m.to.includes(to))
const alertStates = async h => (await h.db.prepare("SELECT value FROM l_records WHERE kind='alert'").all()).results.map(r => JSON.parse(r.value))

/** A business with a published job, its team and the people the two journeys need. */
async function scenario(h) {
 await h.command('business', BUSINESS)
 const people = {
  morgan: await h.member('morgan@example.test', ['manager'], 'Morgan Lee'),
  parker: await h.member('parker@example.test', ['approver'], 'Parker Jones'),
  hana: await h.member('hana@example.test', ['manager'], 'Hana Ito'),
  erin: await h.member('erin@example.test', ['interviewer'], 'Erin Vale'),
  ivy: await h.member('ivy@example.test', ['interviewer'], 'Ivy Chen'),
 }
 const job = async (title, recruiters = ['hana@example.test']) => {
  const v = await h.command('vacancy', { title, location: 'Brooklyn, NY', headcount: 3, manager: 'morgan@example.test', compensation: { currency: 'USD', min: 9000000, max: 11000000, period: 'year' } }, people.morgan)
  await h.command('rubric', { id: v.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] }, people.morgan)
  await h.command('interview-plan', { id: v.id, plan: [{ name: 'Work review', stageName: 'Interview' }] }, people.morgan)
  const asked = await h.command('request-vacancy-approval', { id: v.id, approver: 'parker@example.test' }, people.morgan)
  await h.command('decide-approval', { id: asked.id, decision: 'approved', reason: 'Budget reviewed', version: asked.version }, people.parker)
  await h.command('publish', { id: v.id }, people.morgan)
  await h.command('hiring-team', { id: v.id, recruiters, interviewers: ['ivy@example.test'] })
  return (await h.state(people.morgan)).vacancies.find(x => x.id === v.id)
 }
 const person = (name, vacancy) => h.command('candidate', { name, email: name.toLowerCase().replaceAll(' ', '.') + '@example.test', phone: '+1 555 010 0199', source: 'Referral', consentBasis: 'referral', consentNote: 'Agreed', vacancy: vacancy.id }, people.morgan)
 return { people, job, person }
}

export async function checkMentions() {
 const h = await harness()
 try {
  const { people, job, person } = await scenario(h)
  const { morgan, hana, erin } = people, cmd = h.command
  const a = await job('Site supervisor'), tess = await person('Tess Rivers', a)
  const link = '/app?application=' + tess.application.id
  const home = async cookie => (await h.send('/api/lodge/home', undefined, cookie)).value

  // A mention reaches a colleague with access by email and in-app, with the note and a link; one without gets the text only.
  const text = 'Looping in @hana@example.test and @erin@example.test. Call Tess on +1 555 010 0199 or tess.rivers@example.test about the site walk.'
  const note = await cmd('team-note', { application: tess.application.id, text }, morgan)
  assert.deepEqual(note.mentions.sort(), ['erin@example.test', 'hana@example.test'])
  const [forHana] = await mails(h, 'hana@example.test').then(m => m.filter(x => /mentioned you/.test(x.subject)))
  assert.match(forHana.text, /Call Tess on \+1 555 010 0199/, 'the note text reaches a person who can see the candidate')
  assert.ok(forHana.text.includes(h.origin + link), 'with a link to the candidate')
  const [forErin] = await mails(h, 'erin@example.test').then(m => m.filter(x => /mentioned you/.test(x.subject)))
  assert.match(forErin.text, /Looping in @Hana Ito and @Erin Vale\. Call Tess on \[contact removed\] or \[contact removed\] about the site walk/)
  assert.doesNotMatch(forErin.subject + forErin.text, /555|tess\.rivers|\/app\?|hana@example/, 'no link, address or number reaches someone who cannot see the candidate')

  // HOME-001: the first mention links to the candidate; the second has text and no link, and opening the candidate refuses.
  const homeHana = await home(hana), homeErin = await home(erin)
  assert.deepEqual(homeHana.mentions.map(x => [x.link, x.by]), [[link, 'morgan@example.test']])
  assert.deepEqual(homeErin.mentions.map(x => [x.link, x.textOnly]), [[null, true]])
  assert.equal(homeHana.counts.mentions, 1)
  assert.ok(!(await h.state(erin)).applications.some(x => x.id === tess.application.id), 'a mention opens nothing for Erin')
  await cmd('team-note', { application: tess.application.id, text: 'Trying to get in' }, erin, 404)
  // Mentioning never widens access, and a mention leaves once it is read.
  const alert = (await h.state(hana)).alerts.find(x => x.event === 'mention')
  await cmd('alert-read', { id: alert.id }, hana)
  assert.equal((await home(hana)).counts.mentions, 0)
  assert.equal((await home(erin)).counts.mentions, 1, 'nobody else reads Hana’s items')
  assert.equal((await h.send('/api/lodge/command/alert-read', { id: alert.id }, erin)).status, 404)

  // The employer's choice: refuse mentions of people without access, naming who needs it.
  await cmd('mention-policy', { refuseWithoutAccess: true }, morgan, 403)
  await cmd('mention-policy', { refuseWithoutAccess: true })
  const before = (await alertStates(h)).length
  const refused = await h.send('/api/lodge/command/team-note', { application: tess.application.id, text: 'Ask @erin@example.test' }, morgan)
  assert.equal(refused.status, 409); assert.match(refused.value.error, /Erin Vale cannot see this candidate/)
  assert.equal((await alertStates(h)).length, before, 'a refused mention raised nothing')
  assert.ok(!(await h.state(morgan)).teamNotes.some(n => n.text.includes('Ask @erin')), 'and saved no note')
  await cmd('team-note', { application: tess.application.id, text: 'Ask @hana@example.test' }, morgan)
  // A private note reaches only people who may read it; an unknown or inactive address is not a member.
  const privateRefused = await h.send('/api/lodge/command/team-note', { application: tess.application.id, text: 'Salary: @erin@example.test', private: true }, morgan)
  assert.equal(privateRefused.status, 409)
  assert.equal((await h.send('/api/lodge/command/team-note', { application: tess.application.id, text: 'Hi @nobody@example.test' }, morgan)).status, 400)
  await cmd('team-note', { application: tess.application.id, text: 'Private: @hana@example.test', private: true }, morgan)
  // Editing a note alerts only the people it newly mentions.
  const mine = (await h.state(morgan)).teamNotes.find(n => n.text.startsWith('Ask @hana'))
  const raised = (await alertStates(h)).length
  await cmd('team-note', { id: mine.id, text: 'Ask @hana@example.test again' }, morgan)
  assert.equal((await alertStates(h)).length, raised, 'an edit that adds nobody raises nothing')
  await cmd('mention-policy', { refuseWithoutAccess: false })
  await cmd('team-note', { id: mine.id, text: 'Ask @hana@example.test and @erin@example.test' }, morgan)
  assert.equal((await alertStates(h)).length, raised + 1, 'only the newly mentioned person is alerted')
 } finally { await h.close() }
}

export async function checkNotifications() {
 const h = await harness()
 try {
  const { people, job, person } = await scenario(h)
  const { morgan, hana, ivy } = people, cmd = h.command
  const a = await job('Site supervisor'), b = await job('Estimator')
  const inbox = async (to, pattern) => (await mails(h, to)).filter(m => pattern.test(m.subject))
  const pref = (vacancy, event, email, inApp, cookie = hana) => cmd('notify-pref', { vacancy: vacancy.id, event, ...(email ? { email } : {}), ...(inApp ? { inApp } : {}) }, cookie)

  // Immediate new-application and scorecard email on one job, a digest on the other.
  await pref(a, 'application', 'immediate'); await pref(a, 'scorecard', 'immediate'); await pref(b, 'application', 'digest')
  const tess = await person('Tess Rivers', a)
  await cmd('assign-reviewers', { application: tess.application.id, reviewers: ['ivy@example.test'] }, morgan)
  const [criterion] = a.rubrics.at(-1).criteria
  await cmd('scorecard', { application: tess.application.id, ratings: { [criterion.id]: 3 }, evidence: { [criterion.id]: 'Even grout lines' }, recommendation: 'yes', takeaways: 'Careful finisher', submit: true }, ivy)
  const [applied] = await inbox('hana@example.test', /New application/), [scored] = await inbox('hana@example.test', /submitted a scorecard/)
  assert.equal((await inbox('hana@example.test', /New application|submitted a scorecard/)).length, 2, 'one email each')
  assert.ok(applied.text.includes(h.origin + '/app?application=' + tess.application.id) && scored.text.includes(h.origin + '/app?application=' + tess.application.id), 'each links to the exact item')
  assert.doesNotMatch(scored.text, /Even grout|Careful finisher/, 'a scorecard notice carries no scorecard content')
  const seen = (await h.state(hana)).alerts
  assert.deepEqual(seen.filter(x => ['application', 'scorecard'].includes(x.event)).map(x => x.event).sort(), ['application', 'scorecard'], 'one in-app item each')
  // The reviewer assigned hears of it in-app only (Lodge's default); a public applicant is announced through the public door too.
  assert.ok((await h.state(ivy)).alerts.some(x => x.event === 'assigned' && x.link === '/app?application=' + tess.application.id))
  assert.equal((await mails(h, 'ivy@example.test')).filter(m => /assigned you/.test(m.subject)).length, 0, 'email stays off until chosen')
  const form = new FormData(); for (const [k, v] of Object.entries({ name: 'Walk In', email: 'walk.in@example.test', noticeVersion: '1', consent: 'yes' })) form.append(k, v)
  assert.equal((await h.send('/jobs/' + a.slug, form)).status, 200)
  assert.equal((await inbox('hana@example.test', /New application: Walk In/)).length, 1, 'the public door raises the same notice')

  // The digest: nothing before the morning; then one email listing the digest job.
  await person('Pia Skim', b)
  const digests = () => inbox('hana@example.test', /daily digest/)
  const run = at => h.mf.getWorker().then(w => w.scheduled({ scheduledTime: at }))
  await run(Date.now())
  assert.equal((await digests()).length, 0, 'a digest waits for the morning')
  const morning = Date.parse((await alertStates(h)).find(x => x.emailState === 'digest').digestAt)
  assert.equal(Number(new Date(morning).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })), 8, 'at 8:00 in the business time zone')
  await run(morning + 3600_000)
  const [digest] = await digests()
  assert.equal((await digests()).length, 1)
  assert.ok(digest.text.includes('Estimator') && digest.text.includes('Pia Skim') && !digest.text.includes('Site supervisor'))
  await run(morning + 7200_000)
  assert.equal((await digests()).length, 1, 'a digest is sent once')

  // Removing the manager from the digest job before the digest excludes it, with live access checked at send time.
  await person('Lou Float', b)
  await pref(a, 'feedback', 'digest')
  await cmd('release-feedback', { application: tess.application.id, reason: 'Panel done' }, morgan)
  await cmd('hiring-team', { id: b.id, recruiters: [], interviewers: ['ivy@example.test'] })
  const next = Date.parse((await alertStates(h)).filter(x => x.emailState === 'digest').map(x => x.digestAt).sort().at(0))
  await run(next + 3600_000)
  const second = await digests()
  assert.equal(second.length, 2); assert.ok(second[1].text.includes('Site supervisor') && !second[1].text.includes('Estimator') && !second[1].text.includes('Lou Float'))
  assert.ok((await alertStates(h)).some(x => x.event === 'application' && x.emailState === 'withheld'), 'the removed job’s notice was withheld')

  // Unsubscribing stops future notifications only; admin defaults by role apply until a member chooses.
  await pref(a, 'application', 'off')
  const count = async () => (await inbox('hana@example.test', /New application/)).length, was = await count()
  await person('Ned Bond', a)
  assert.equal(await count(), was, 'nothing new after turning it off'); assert.ok((await h.state(hana)).alerts.some(x => x.event === 'application'), 'what was raised stays')
  const sam = await h.member('sam@example.test', ['manager'], 'Sam Coordinator')
  await cmd('hiring-team', { id: a.id, recruiters: ['hana@example.test'], coordinators: ['sam@example.test'], interviewers: ['ivy@example.test'] })
  await cmd('notify-default', { role: 'coordinators', event: 'application', email: 'immediate' }, hana, 403)
  await cmd('notify-default', { role: 'coordinators', event: 'application', email: 'immediate' })
  await person('Oli Park', a)
  assert.equal((await inbox('sam@example.test', /New application: Oli Park/)).length, 1, 'the role default sends')
  await pref(a, 'application', 'off', null, sam)
  await person('Una Hart', a)
  assert.equal((await inbox('sam@example.test', /New application: Una Hart/)).length, 0, 'a member’s own choice wins')
  assert.equal((await h.send('/api/lodge/command/notify-pref', { vacancy: a.id, event: 'offer', email: 'immediate' }, people.parker)).status, 404, 'only for jobs they are on')
 } finally { await h.close() }
}
