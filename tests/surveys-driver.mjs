import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { businessHarness } from './harness.mjs'
import { careersJob } from './careers-driver.mjs'

const form = fields => { const b = new FormData(); for (const [k, v] of Object.entries(fields)) b.set(k, v); return b }
const mail = async (h, to) => (await h.db.prepare('SELECT message FROM rer_mail_development_outbox ORDER BY sequence DESC').all()).results.map(x => JSON.parse(x.message)).find(m => m.to.includes(to))

// REPORT-004 public-door journey. Only the existing provider network edge is replaced.
export async function checkSurveys(browser, evidence) {
  const h = await businessHarness()
  try {
    const job = await careersJob(h.command, 'Synthetic survey crew')
    const interviewer = await h.member('synthetic-lodge-surveyor@example.test', ['interviewer'])
    const trigger = job.stages.at(-1).id
    const config = async (event, language = 'en', subject = 'Experience survey') => h.command('survey-configure', { vacancy: job.id, trigger: event, title: event === 'withdrawn' ? 'Withdrawal experience' : 'Post-interview experience', questions: ['How clear was the process?', 'How timely was scheduling?'], language, subject, invitation: language === 'es' ? 'Comparta su experiencia de forma voluntaria.' : 'Please share your experience voluntarily.', enabled: true })
    const stage = await config(trigger), closure = await config('withdrawn')
    assert.equal((await h.send('/surveys/settings', undefined, interviewer)).status, 403)
    assert.equal((await h.send('/api/lodge/reports/surveys', undefined, interviewer)).status, 403)
    assert.equal((await h.send('/surveys/settings')).status, 401)
    assert.equal((await h.send('/api/lodge/command/survey-configure', { vacancy: job.id }, interviewer)).status, 403)
    const apps = [], links = []
    const report = async () => (await h.send('/api/lodge/reports/surveys', undefined, h.owner)).value
    const send = async (app, survey, expected = 200) => {
      const out = await h.send('/surveys/send', form({ application: app.id, survey: survey.id, confirm: 'yes' }), h.owner)
      assert.equal(out.status, expected, out.text)
      if (expected !== 200) return
      assert.match(out.text, /Handed to the mail provider/)
      const m = await mail(h, app.email)
      const response = new URL(m.text.match(/http:\/\/\S+\/surveys\/respond\/\S+/)[0]).pathname
      const stop = new URL(m.text.match(/http:\/\/\S+\/surveys\/stop\/\S+/)[0]).pathname
      return { response, stop }
    }
    for (const [group, survey] of [['stage', stage], ['closure', closure]]) {
      for (let i = 0; i < 5; i++) {
        const email = `synthetic-lodge-${group}-${i}@example.test`
        const { candidate, application } = await h.command('candidate', { name: `Synthetic survey ${group} ${i}`, email, vacancy: job.id, consentBasis: 'manual', source: 'Synthetic survey' })
        const app = { ...application, candidate: candidate.id, email }; apps.push(app)
        if (group === 'stage' && i === 1) {
          const iv = await h.command('interview', { application: app.id, planItem: job.plan[0].id, participants: ['owner@example.test'], durationMinutes: 30, slots: [new Date(Date.now() + 48 * 3600000).toISOString()] })
          await h.command('schedule', { interview: iv.id, slot: 0 })
        }
        if (group === 'stage') await h.command('move', { application: app.id, to: trigger, reason: 'Interview completed; employer selected this stage' })
        else await h.command('move', { application: app.id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Candidate withdrew' })
        if (i === 0) await send(app, survey, 409)
        await h.command('survey-consent', { application: app.id, enabled: true, basis: 'Candidate explicitly agreed outside Lodge; synthetic consent receipt' })
        const link = await send(app, survey); links.push(link)
        assert.equal((await h.send(link.response)).status, 200)
        if (i === 0) {
          await send(app, survey, 409)
          assert.equal((await h.send(link.response, form({ mode: 'identified', consent: 'yes', 'score-0': '4', 'score-1': '3' }))).status, 400, 'identity needs separate consent')
          assert.equal((await h.send(link.response, form({ mode: 'anonymous', consent: 'yes', 'score-0': '4', 'score-1': '3' }), '', { origin: 'https://example.test' })).status, 403)
        }
        let response
        if (browser && i === 0) {
          for (const width of [1440, 390]) {
            const ctx = await browser.newContext({ viewport: { width, height: 1000 } }), p = await ctx.newPage()
            await p.goto(h.origin + link.response)
            await p.getByRole('heading', { name: survey.title }).waitFor()
            assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'survey fits viewport')
            await p.getByLabel('How clear was the process?', { exact: true }).selectOption('4')
            await p.getByLabel('How timely was scheduling?', { exact: true }).selectOption('3')
            await p.getByRole('checkbox', { name: 'I choose to share my experience.' }).check()
            if (width === 1440) {
              await p.getByLabel('Response identity', { exact: true }).selectOption('identified')
              await p.getByRole('checkbox', { name: /^If I choose Identified/ }).check()
            }
            await p.screenshot({ path: `${evidence}/${group}-response-${width}.png`, fullPage: true })
            if (width === 390) {
              const [submitted] = await Promise.all([p.waitForNavigation(), p.getByRole('button', { name: 'Share experience', exact: true }).click()])
              response = { status: submitted.status(), text: await p.content() }
              await p.getByRole('heading', { name: 'Thank you · Gracias' }).waitFor()
              await p.screenshot({ path: `${evidence}/${group}-recorded-${width}.png`, fullPage: true })
            }
            await ctx.close()
          }
        }
        response ??= await h.send(link.response, form({ mode: i === 0 ? 'anonymous' : 'identified', identify: i === 0 ? '' : 'yes', consent: 'yes', 'score-0': '4', 'score-1': '3' }))
        assert.equal(response.status, 200, response.text)
        const unchanged = (await h.state()).applications.find(x => x.id === app.id)
        assert.deepEqual([unchanged.stage, unchanged.status], [group === 'stage' ? trigger : application.stage, group === 'stage' ? 'active' : 'withdrawn'], 'experience answers never move a stage or change suitability')
        assert.equal((await h.send(link.response)).status, 404, 'consumed link reveals nothing')
        const r = (await report()).surveys.find(x => x.id === survey.id)
        assert.deepEqual([r.invitations, r.responses, r.responseRate, r.suppressed], [i + 1, i + 1, 1, i < 4])
        assert.deepEqual(r.averages, i < 4 ? null : [4, 3])
        if (i < 4) assert.deepEqual(r.identified, [])
        else assert.deepEqual(r.identified.map(x => x.candidateName).sort(), [1, 2, 3, 4].map(n => `Synthetic survey ${group} ${n}`))
      }
    }
    const stageReport = (await report()).surveys.find(r => r.id === stage.id)
    const linked = stageReport.identified.find(x => x.application === apps[1].id)
    assert.ok(linked.schedulingHours.length === 1 && linked.schedulingHours[0] >= 47 && linked.schedulingHours[0] <= 49, 'consented feedback joins actual interview timing')
    // Anonymous answers have no identifying keys, token, timestamps, or linkage in any candidate door.
    const rows = (await h.db.prepare("SELECT value FROM l_records WHERE kind='survey-response'").all()).results.map(x => JSON.parse(x.value))
    const anonymous = rows.filter(r => !r.candidate)
    assert.equal(anonymous.length, 2)
    for (const row of anonymous) assert.deepEqual(Object.keys(row).sort(), ['expiresAt', 'id', 'scores', 'survey', 'version'])
    const exported = await h.send('/api/lodge/download/candidate/' + apps[0].candidate, undefined, h.owner)
    assert.equal(exported.status, 200, exported.text)
    for (const row of anonymous) assert.ok(!exported.text.includes(row.id))
    assert.ok(!(await h.state(interviewer)).candidates.some(c => c.id === apps[0].candidate), 'unassigned interviewer sees no candidate or survey')
    // Decline contact using a separate preference capability, including after an anonymous response.
    const before = (await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n
    assert.equal((await h.send(links[0].stop, form({}))).status, 200)
    await send(apps[0], stage, 409)
    assert.equal((await h.send('/api/lodge/command/survey-consent', { application: apps[0].id, enabled: true, basis: 'Attempt to override refusal' }, h.owner)).status, 409)
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM rer_mail_development_outbox').first()).n, before)
    assert.equal((await h.send('/surveys/respond/synthetic-lodge-unknown')).status, 404)
    // Language review blocks an English application from a Spanish-only invitation.
    await config(trigger, 'es')
    const extra = await h.command('candidate', { name: 'Synthetic survey extra', email: 'synthetic-lodge-extra@example.test', vacancy: job.id, consentBasis: 'manual', source: 'Synthetic survey' })
    await h.command('move', { application: extra.application.id, to: trigger, reason: 'Interview complete' })
    await h.command('survey-consent', { application: extra.application.id, enabled: true, basis: 'Explicit synthetic consent' })
    await send({ ...extra.application, email: extra.candidate.email }, stage, 409)
    await config(trigger)
    // The reviewed Spanish invitation follows a real Spanish public application, with no English mail fallback.
    const { languageJob, spanishText } = await import('./languages-driver.mjs')
    const localized = await languageJob(h.command, async request => h.command('decide-approval', { id: request.id, decision: 'approved', version: request.version, reason: 'Synthetic reviewed job' }), 'owner@example.test')
    await h.command('post-translation', { vacancy: localized.job.id, post: localized.es.id, translation: spanishText(localized.q) })
    await h.command('post-status', { vacancy: localized.job.id, post: localized.es.id, status: 'live' })
    const intake = await h.send('/jobs/' + localized.es.slug, form({ name: 'Synthetic Spanish survey', email: 'synthetic-lodge-es@example.test', noticeVersion: '1', consent: 'yes', ['q-' + localized.q.id]: 'Weekdays' }))
    assert.equal(intake.status, 200, intake.text)
    const spanishApp = (await h.state()).applications.find(a => a.candidateName === 'Synthetic Spanish survey')
    assert.equal(spanishApp.language, 'es')
    const spanishSurvey = await h.command('survey-configure', { vacancy: localized.job.id, trigger: spanishApp.stage, title: 'Su experiencia', questions: ['¿Fue claro el proceso?'], language: 'es', subject: 'Comparta su experiencia', invitation: 'La participación es voluntaria.', enabled: true })
    await h.command('survey-consent', { application: spanishApp.id, enabled: true, basis: 'Explicit synthetic Spanish consent' })
    const spanishLink = await send({ ...spanishApp, email: 'synthetic-lodge-es@example.test' }, spanishSurvey)
    const spanishMail = await mail(h, 'synthetic-lodge-es@example.test')
    assert.equal(spanishMail.subject, 'Comparta su experiencia')
    assert.ok(spanishMail.text.includes('La participación es voluntaria.') && spanishMail.text.includes('Dejar de recibir contacto') && !spanishMail.text.includes('Stop further contact'))
    assert.match((await h.send(spanishLink.response)).text, /<html lang="es"/)
    // Provider failure is never recorded as delivered and does not increase the denominator.
    await h.db.prepare("CREATE TRIGGER fail_survey_mail BEFORE INSERT ON rer_mail_development_outbox WHEN NEW.message LIKE '%Experience failure%' BEGIN SELECT RAISE(ABORT,'synthetic provider refusal'); END").run()
    const failed = await config(trigger, 'en', 'Experience failure')
    const result = await h.send('/surveys/send', form({ application: extra.application.id, survey: failed.id, confirm: 'yes' }), h.owner)
    assert.equal(result.status, 200, result.text); assert.match(result.text, /Mail failed/)
    const failedReport = (await report()).surveys.find(x => x.id === stage.id)
    assert.deepEqual([failedReport.invitations, failedReport.responses], [0, 0])
    await send({ ...extra.application, email: extra.candidate.email }, failed, 409)
    if (browser) {
      for (const width of [1440, 390]) {
        const ctx = await browser.newContext({ viewport: { width, height: 1100 } })
        await ctx.addCookies(h.owner.split('; ').map(c => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), url: h.origin } }))
        const p = await ctx.newPage(); await p.goto(h.origin + '/surveys/settings')
        await p.getByRole('heading', { name: 'Aggregate results' }).waitFor()
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'settings fit viewport')
        await p.screenshot({ path: `${evidence}/settings-${width}.png`, fullPage: true })
        await p.goto(h.origin + links[1].stop); await p.getByRole('button', { name: 'Stop contact' }).focus()
        await p.screenshot({ path: `${evidence}/opt-out-${width}.png`, fullPage: true })
        await ctx.close()
      }
    }
    // Erasure removes identified responses and preference capabilities while leaving unlinkable aggregates alone.
    await h.command('move', { application: apps[1].id, to: 'withdrawn', closeReason: 'other-offer', reason: 'Erasure request' })
    const deletion = await h.send('/api/lodge/delete-candidate', { candidate: apps[1].candidate, confirm: 'Synthetic survey stage 1', reason: 'Synthetic erasure request' }, h.owner)
    assert.equal(deletion.status, 200, deletion.text)
    assert.equal((await h.send(links[1].stop, form({}))).status, 404)
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='survey-response' AND json_extract(value,'$.candidate')=?").bind(apps[1].candidate).first()).n, 0)
    // Expiry through the scheduled runtime door, using a fixed expired instant rather than a wall-clock boundary.
    await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.expiresAt','2000-01-01T00:00:00.000Z') WHERE kind IN ('survey-response','survey-invitation','survey-stop','survey-receipt','survey-denominator')").run()
    const hold = await h.command('hold', { vacancy: job.id, reason: 'Synthetic survey legal hold' })
    await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.now(), cron: '0 * * * *' }))
    assert.ok((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind='survey-response'").first()).n > 0, 'legal hold preserves expired answers without exposing them')
    assert.ok((await report()).surveys.every(r => r.responses === 0))
    await h.command('release-hold', { id: hold.id, reason: 'Synthetic hold released' })
    await h.mf.getWorker().then(w => w.scheduled({ scheduledTime: Date.now(), cron: '0 * * * *' }))
    assert.equal((await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind IN ('survey-response','survey-invitation','survey-stop','survey-receipt','survey-denominator')").first()).n, 0)
    assert.ok((await report()).surveys.every(r => r.responses === 0 && r.invitations === 0))
    return { groups: 2, responses: 10, anonymous: 2, widths: browser ? [1440, 390] : [] }
  } finally { await h.close() }
}

if (process.argv.includes('--browser')) {
  const { chromium } = await import('@playwright/test')
  const evidence = process.env.LODGE_EVIDENCE
  assert.ok(evidence, 'Set an evidence directory outside the product repository')
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.LODGE_CHROMIUM_EXECUTABLE, args: ['--use-mock-keychain', '--password-store=basic'] })
  try { console.log(await checkSurveys(browser, evidence)) } finally { await browser.close() }
}

export async function surveysWorkspacePage(browser, { root, origin, run, evidence }) {
  const { session } = await import('./browser-journey.mjs')
  for (const width of [1440, 390]) {
    const owner = await session(browser, root, origin, 'owner', width)
    try {
      await owner.page.goto(origin + '/app')
      await owner.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^People/ }).click()
      const link = owner.page.getByRole('link', { name: 'Configure surveys and view permitted aggregate results' })
      await link.waitFor()
      assert.ok(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await owner.page.screenshot({ path: `${evidence}/people-surveys-${width}.png`, fullPage: true })
      await link.click()
      await owner.page.getByRole('heading', { name: 'Candidate experience surveys', exact: true }).waitFor()
      assert.ok(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await owner.page.screenshot({ path: `${evidence}/workspace-surveys-${width}.png`, fullPage: true })
    } finally { await owner.context.close() }
  }
}
