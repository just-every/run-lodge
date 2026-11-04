import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'
import { careersJob } from './careers-driver.mjs'
import { languageJob, spanishText } from './languages-driver.mjs'
import { address, candidateSession, form } from './take-home-flow.mjs'

export async function itineraryFixture() {
  let outbound = 0
  const h = await businessHarness({ clock: '2027-03-01T12:00:00Z', outboundService: () => { outbound++; return new Response('No provider authorized', { status: 503 }) } })
  try {
    const job = await careersJob(h.command, 'Synthetic itinerary role')
    const panellists = [address(710), address(711)]
    const staff = []
    for (const [i, email] of panellists.entries()) staff.push(await h.member(email, ['interviewer'], 'Synthetic interviewer ' + (i + 1)))
    const candidateEmail = address(712), otherEmail = address(713)
    for (const email of [candidateEmail, otherEmail]) assert.equal((await h.send('/jobs/' + job.slug, form({ name: email === candidateEmail ? 'Synthetic itinerary candidate' : 'Synthetic other candidate', email, noticeVersion: '1', consent: 'yes' }))).status, 200)
    const w = await h.state(), person = w.candidates.find(c => c.email === candidateEmail), app = w.applications.find(a => a.candidate === person.id), receipt = w.receipts.find(r => r.application === app.id)
    const other = w.applications.find(a => a.candidate === w.candidates.find(c => c.email === otherEmail).id)
    const starts = ['2027-03-14T06:30:00.000Z', '2027-03-14T07:30:00.000Z', '2027-03-14T15:00:00.000Z']
    const interviews = []
    for (const [i, start] of starts.entries()) {
      const iv = await h.command('interview', { application: app.id, planItem: job.plan[0].id, participants: panellists, durationMinutes: [30, 45, 60][i], slots: [start, '2027-03-15T16:00:00.000Z'], location: i === 2 ? 'https://example.test/synthetic-lodge-room' : 'Synthetic room ' + (i + 1) })
      for (const cookie of staff) await h.command('availability', { interview: iv.id, slots: [0, 1] }, cookie)
      await h.command('schedule', { interview: iv.id, slot: 0 })
      await h.command('interview-self-scheduling', { interview: iv.id, enabled: true })
      interviews.push(iv)
    }
    const foreign = await h.command('interview', { application: other.id, planItem: job.plan[0].id, participants: panellists, slots: ['2027-03-16T16:00:00.000Z'], location: 'Synthetic private other application' })
    await h.command('schedule', { interview: foreign.id, slot: 0 })
    const proposed = await h.command('interview', { application: app.id, planItem: job.plan[0].id, participants: panellists, slots: ['2027-03-18T16:00:00.000Z'], location: 'Synthetic not scheduled' })
    await h.command('scorecard', { application: app.id, interview: interviews[0].id, ratings: {}, evidence: {}, takeaways: 'Synthetic private feedback remains internal', submit: false }, staff[0])
    const cookie = await candidateSession(h, candidateEmail), otherCookie = await candidateSession(h, otherEmail)
    const path = '/candidate/receipts/' + receipt.id + '/itinerary'
    const settings = async () => (await h.state()).candidateItineraries.find(r => r.application === app.id)
    const reviewInput = async () => {
      const config = await settings()
      return { application: app.id, version: config.version, source: config.source, enabled: true, reviewed: true, language: config.language, copy: config.copy, sessions: config.sessions.map((iv, i) => ({ interview: iv.id, title: 'Synthetic reviewed session ' + (interviews.findIndex(x => x.id === iv.id) + 1), location: iv.location, panel: i === 0 ? [{ member: panellists[0], name: 'Synthetic approved interviewer', title: 'Safety lead' }] : [] })) }
    }
    return { h, job, app, person, receipt, interviews, foreign, proposed, starts, panellists, staff, cookie, otherCookie, path, settings, reviewInput, outbound: () => outbound }
  } catch (error) { await h.close(); throw error }
}

export function parseCalendar(bytes) {
  const unfolded = bytes.replace(/\r\n[ \t]/g, '')
  const events = [...unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT/g)].map(m => Object.fromEntries(m[1].trim().split('\r\n').map(line => { const split = line.indexOf(':'); return [line.slice(0, split), line.slice(split + 1)] })))
  assert.match(unfolded, /^BEGIN:VCALENDAR\r\nVERSION:2.0/)
  assert.match(unfolded, /\r\nEND:VCALENDAR\r\n$/)
  for (const line of bytes.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'calendar lines fold by UTF-8 octets')
  return events
}

/** One public-door sanity journey: actual records, exact disclosed bytes, both sides of privacy and lifecycle. */
export async function checkCandidateItinerary() {
  const f = await itineraryFixture(), { h, app, path, cookie, otherCookie, interviews, panellists } = f
  try {
    const snapshot = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const noWrite = async (fn, expected) => { const before = await snapshot(), r = await fn(); assert.equal(r.status, expected, r.text); assert.deepEqual(await snapshot(), before); return r }
    const read = (suffix = '', who = cookie) => h.send(path + suffix, undefined, who)
    const unavailable = async () => { await noWrite(() => read(), 404); await noWrite(() => read('/calendar.ics'), 404) }
    await unavailable() // Self-scheduling alone never authorizes itinerary or panel disclosure.
    const review = await f.reviewInput()
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', review, f.staff[0]), 403)
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', { ...review, sessions: [...review.sessions, { interview: f.foreign.id, title: 'Wrong application', location: 'Other room' }] }, h.owner), 409)
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', { ...review, sessions: [...review.sessions, { interview: f.proposed.id, title: 'Not scheduled', location: 'Other room' }] }, h.owner), 409)
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', { ...review, sessions: review.sessions.map((iv, i) => i ? iv : { ...iv, location: '/app?kit=' + interviews[0].id }) }, h.owner), 400)
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', { ...review, language: 'es' }, h.owner), 400)
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', { ...review, sessions: review.sessions.map((iv, i) => i ? iv : { ...iv, panel: [{ member: panellists[0], name: panellists[0], title: 'Lead' }] }) }, h.owner), 400)
    await h.command('candidate-itinerary-review', review)
    const page = await read('?zone=America%2FNew_York'), la = await read('?zone=America%2FLos_Angeles')
    assert.equal(page.status, 200); assert.equal(la.status, 200)
    // Independently specified instants across the spring gap: no local 02:30 exists.
    for (const value of ['1:30 AM EST', '3:30 AM EDT', '11:00 AM EDT', '30 minutes', '45 minutes', '60 minutes', 'Synthetic approved interviewer', 'Safety lead']) assert.ok(page.text.includes(value), value)
    for (const value of ['10:30 PM PST', '11:30 PM PST', '8:00 AM PDT']) assert.ok(la.text.includes(value), value)
    const cal = await read('/calendar.ics?zone=America%2FLos_Angeles'), events = parseCalendar(cal.text)
    assert.equal(cal.status, 200); assert.match(cal.headers.get('cache-control'), /no-store/)
    assert.equal(events.length, 3)
    assert.deepEqual(events.map(e => [e.DTSTART, e.DTEND, e.STATUS]), [['20270314T063000Z', '20270314T070000Z', 'CONFIRMED'], ['20270314T073000Z', '20270314T081500Z', 'CONFIRMED'], ['20270314T150000Z', '20270314T160000Z', 'CONFIRMED']])
    const ids = events.map(e => e.UID)
    for (const bytes of [page.text, la.text, cal.text]) {
      for (const hidden of [...panellists, f.foreign.id, 'Synthetic private other application', 'Synthetic not scheduled', '/app?kit', 'ATTENDEE', 'ORGANIZER', 'scorecard', 'feedback', 'Synthetic private feedback remains internal', 'Synthetic interviewer 2']) assert.ok(!bytes.includes(hidden), 'private field excluded: ' + hidden)
    }
    for (const suffix of ['', '/calendar.ics']) {
      await noWrite(() => read(suffix, otherCookie), 404)
      await noWrite(() => read(suffix, ''), 401)
      await noWrite(() => h.send('/candidate/receipts/unknown/itinerary' + suffix, undefined, otherCookie), 404)
    }
    // The staff attachment still contains panel addresses and kit links; the candidate has no access to that door.
    assert.match((await h.send('/api/lodge/download/calendar/' + interviews[0].id, undefined, h.owner)).text, /ATTENDEE/)
    await noWrite(() => h.send('/api/lodge/download/calendar/' + interviews[0].id, undefined, cookie), 403)
    await noWrite(() => read('?zone=invalid'), 400)
    const old = await f.reviewInput()
    await h.command('member', { email: panellists[0], roles: ['interviewer'], name: 'Synthetic changed interviewer' })
    await unavailable()
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', old, h.owner), 409)
    await h.command('candidate-itinerary-review', await f.reviewInput())
    // Candidate reschedule changes the actual interview and invalidates the reviewed old time.
    assert.equal((await h.send('/candidate/receipts/' + f.receipt.id + '/interviews/' + interviews[0].id, form({ previousStart: f.starts[0], start: '2027-03-15T16:00:00.000Z' }), cookie)).status, 303)
    await unavailable()
    await h.command('candidate-itinerary-review', await f.reviewInput())
    assert.match((await read()).text, /Rescheduled/)
    let changed = parseCalendar((await read('/calendar.ics')).text)
    assert.deepEqual(changed.map(e => e.UID).sort(), [...ids].sort(), 'rescheduling preserves stable event identities')
    assert.equal(changed.find(e => e.UID.startsWith(interviews[0].id)).DTSTART, '20270315T160000Z')
    await h.command('cancel-interview', { interview: interviews[2].id, reason: 'Synthetic internal cancellation detail' })
    await unavailable()
    await h.command('candidate-itinerary-review', await f.reviewInput())
    assert.match((await read()).text, /Canceled/)
    const cancelled = await read('/calendar.ics')
    changed = parseCalendar(cancelled.text)
    assert.equal(changed.find(e => e.UID.startsWith(interviews[2].id)).STATUS, 'CANCELLED')
    assert.ok(!cancelled.text.includes('Synthetic internal cancellation detail'))
    const adminAddress = address(716), admin = await h.member(adminAddress, ['admin'], 'Synthetic sharing reviewer')
    await h.command('candidate-itinerary-review', await f.reviewInput(), admin)
    assert.equal((await read()).status, 200)
    await h.command('member', { email: adminAddress, name: 'Synthetic sharing reviewer', roles: ['admin'], active: false })
    await unavailable()
    await h.command('candidate-itinerary-review', await f.reviewInput())
    assert.equal((await read()).status, 200, 'a new current human review is required after reviewer revocation')

    // A concurrent exact review has one winner, rather than two silently divergent projections.
    const concurrent = await f.reviewInput(), beforeVersion = concurrent.version
    const results = await Promise.all([h.send('/api/lodge/command/candidate-itinerary-review', concurrent, h.owner), h.send('/api/lodge/command/candidate-itinerary-review', concurrent, h.owner)])
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
    assert.equal((await f.settings()).version, beforeVersion + 1)
    const escaped = await f.reviewInput()
    escaped.sessions[0].title = 'Synthetic <script>alert(1)</script>; ' + 'Seguridad ééé '.repeat(9) + '\r\nSUMMARY:Injected'
    escaped.sessions[0].location = 'Synthetic room, floor 2; east\nUse main entrance'
    await h.command('candidate-itinerary-review', escaped)
    const escapedPage = await read(), escapedCal = await read('/calendar.ics')
    assert.ok(escapedPage.text.includes('&lt;script&gt;'))
    assert.ok(!escapedPage.text.includes('<script>alert(1)</script>'))
    const escapedEvents = parseCalendar(escapedCal.text)
    assert.equal(escapedEvents.length, 3)
    assert.equal(escapedEvents.filter(e => e.SUMMARY === 'Injected').length, 0)
    assert.ok(escapedCal.text.replace(/\r\n[ \t]/g, '').includes('floor 2\\; east\\nUse main entrance'))

    // A real Spanish intake retains its own reviewed language and has no English fallback review.
    const ownerEmail = (await h.state()).actor.email
    const approve = request => h.command('decide-approval', { id: request.id, version: request.version, decision: 'approved', reason: 'Synthetic language proof' })
    const localized = await languageJob(h.command, approve, ownerEmail)
    await h.command('post-translation', { vacancy: localized.job.id, post: localized.es.id, translation: spanishText(localized.q) })
    await h.command('post-status', { vacancy: localized.job.id, post: localized.es.id, status: 'live' })
    const esEmail = address(715)
    assert.equal((await h.send('/jobs/' + localized.es.slug, form({ name: 'Synthetic Spanish candidate', email: esEmail, noticeVersion: '1', consent: 'yes', ['q-' + localized.q.id]: 'Weekdays' }))).status, 200)
    const spanish = await h.state(), esApp = spanish.applications.find(a => a.candidate === spanish.candidates.find(c => c.email === esEmail).id), esReceipt = spanish.receipts.find(r => r.application === esApp.id)
    const esInterview = await h.command('interview', { application: esApp.id, planItem: localized.job.plan[0].id, participants: panellists, slots: ['2027-03-17T15:00:00.000Z'] })
    await h.command('schedule', { interview: esInterview.id, slot: 0 })
    const esConfig = (await h.state()).candidateItineraries.find(r => r.application === esApp.id)
    const esReview = { application: esApp.id, enabled: true, reviewed: true, source: esConfig.source, version: esConfig.version, language: 'es', copy: esConfig.copy, sessions: [{ interview: esInterview.id, title: 'Conversación de seguridad', location: 'Sala norte', panel: [] }] }
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', { ...esReview, language: 'en' }, h.owner), 400)
    await h.command('candidate-itinerary-review', esReview)
    const esCookie = await candidateSession(h, esEmail), esPath = '/candidate/receipts/' + esReceipt.id + '/itinerary'
    const esPage = await h.send(esPath + '?zone=Europe%2FMadrid', undefined, esCookie)
    assert.equal(esPage.status, 200)
    assert.match(esPage.text, /<html lang="es"/)
    for (const value of ['Tu itinerario de entrevistas', 'Conversación de seguridad', 'Programada', 'minutos', 'Sala norte']) assert.ok(esPage.text.includes(value), value)
    const esEvents = parseCalendar((await h.send(esPath + '/calendar.ics', undefined, esCookie)).text)
    assert.equal(esEvents[0].SUMMARY, 'Conversación de seguridad')
    assert.match(esEvents[0].DESCRIPTION, /Programada/)

    // Exact review cannot be replayed to overwrite a later disable, including across restart.
    const beforeDisable = await f.reviewInput()
    await h.command('candidate-itinerary-review', { application: app.id, enabled: false, version: beforeDisable.version })
    await unavailable(); await h.restart()
    await noWrite(() => h.send('/api/lodge/command/candidate-itinerary-review', beforeDisable, h.owner), 409)
    await h.command('candidate-itinerary-review', await f.reviewInput())
    const renewed = await h.signIn(f.person.email)
    assert.equal((await h.send('/candidate/signout', {}, cookie)).status, 303)
    for (const suffix of ['', '/calendar.ics']) await noWrite(() => read(suffix), 401)
    assert.equal((await read('', renewed)).status, 200)
    // Changing canonical identity also invalidates disclosure for a freshly authenticated new identity.
    const changedEmail = address(714)
    await h.command('correct-candidate', { ...f.person, id: f.person.id, email: changedEmail, reason: 'Synthetic identity correction' })
    await noWrite(() => read('', renewed), 404)
    const newCookie = await candidateSession(h, changedEmail)
    await noWrite(() => read('', newCookie), 404)
    await h.command('candidate-itinerary-review', await f.reviewInput())
    assert.equal((await read('', newCookie)).status, 200)
    await h.send('/candidate/receipts/' + f.receipt.id + '/account/withdraw', form({ confirm: 'yes' }), newCookie)
    for (const suffix of ['', '/calendar.ics']) await noWrite(() => read(suffix, newCookie), 404)
    assert.equal((await h.send('/api/lodge/delete-candidate', { candidate: f.person.id, confirm: f.person.name, reason: 'Synthetic erasure' }, h.owner)).status, 200)
    assert.equal((await snapshot()).some(r => r.kind === 'application' && r.id === app.id || r.kind === 'interview' && interviews.some(iv => iv.id === r.id)), false)
    await h.restart()
    for (const suffix of ['', '/calendar.ics']) await noWrite(() => read(suffix, newCookie), 404)
    assert.equal(f.outbound(), 0, 'native sharing and downloads make zero outbound provider requests')
    console.log('PROBE CAL-004 review: native HTTP sessions and independent sharing -> three reviewed sessions only; self-scheduling alone refused')
    console.log('PROBE CAL-004 projection: candidate HTTP page and parsed ICS -> DST times, durations, approved names, no panel addresses or internal fields')
    console.log('PROBE CAL-004 language: Spanish public intake and exact human review -> Spanish page and parsed calendar; wrong-language review refused')
    console.log('PROBE CAL-004 changes: native reschedule and cancellation -> stale review refused; current reviewed calendar state and stable identities')
    console.log('PROBE CAL-004 lifecycle: wrong identity, signout, disable, withdrawal, erasure and restart -> access refused; zero outbound requests')
  } finally { await h.close() }
}
