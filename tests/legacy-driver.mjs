// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { BUSINESS, harness } from "./harness.mjs"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"

// MIG-009 legacy application links through the real Worker, with current publication/access checks.



export async function legacyJob(run, state, ownerEmail, title = 'Legacy yard role') {
  let v = await run('vacancy', { title, location: 'Brooklyn, NY', headcount: 2, manager: ownerEmail, description: 'Keep the yard safe.', compensation: { currency: 'USD', min: 6000000, max: 7000000, period: 'year' } })
  await run('rubric', { id: v.id, criteria: [{ name: 'Safety', description: 'Keeps people safe' }] })
  await run('interview-plan', { id: v.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
  const asked = await run('request-vacancy-approval', { id: v.id, approver: ownerEmail })
  await run('decide-approval', { id: asked.id, decision: 'approved', version: (await state()).approvals.find(a => a.id === asked.id).currentVersion, reason: 'Approved hiring budget' })
  v = await run('publish', { id: v.id })
  return v
}

export async function checkLegacyLinks(t) {
  const h = await harness(); t.after(() => h.close())
  const { command: run, state, send, owner } = h
  await run('business', BUSINESS)
  const v = await legacyJob(run, state, 'owner@example.test')
  const office = await run('office', { name: 'Legacy yard' })
  // Use a real approved job with an office for ATTR-012's per-post destination.
  const postJob = await run('vacancy', { title: 'Posted legacy role', officeId: office.id, headcount: 1, manager: 'owner@example.test', compensation: v.compensation })
  await run('rubric', { id: postJob.id, criteria: [{ name: 'Safety', description: 'Works safely' }] })
  await run('interview-plan', { id: postJob.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
  const asked = await run('request-vacancy-approval', { id: postJob.id, approver: 'owner@example.test' })
  await run('decide-approval', { id: asked.id, decision: 'approved', version: (await state()).approvals.find(a => a.id === asked.id).currentVersion, reason: 'Approved' })
  await run('publish', { id: postJob.id })
  const withPost = await run('job-post', { vacancy: postJob.id, title: 'Legacy post', description: 'Join this crew.', locations: [office.id], destinations: ['careers', 'embed'] })
  const post = withPost.posts[0]
  await run('post-status', { vacancy: postJob.id, post: post.id, status: 'live' })
  const map = { source: 'greenhouse', sourceId: 'old-42', sourceUrl: 'https://boards.greenhouse.io/example/jobs/old-42', vacancy: postJob.id, post: post.id }
  await run('legacy-link', map)
  let redirect = await send('/jobs/legacy/greenhouse/old-42')
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get('location'), '/jobs/' + post.slug)
  assert.equal(redirect.headers.get('cache-control'), 'no-store', 'availability changes must not leave a cached redirect')
  await run('job-board', { token: 'legacy-board', allowedOrigins: ['https://careers.example.test'] })
  const embedded = await send('/embed/jobs?gh_jid=old-42&utm_source=old-email')
  assert.equal(embedded.status, 302)
  assert.equal(embedded.headers.get('location'), '/embed/jobs/' + post.slug + '?utm_source=old-email')
  // Applying on the redirected post uses the normal versioned public form and lands on its mapped job/post.
  const form = new FormData()
  for (const [key, value] of Object.entries({ name: 'Legacy applicant', email: 'legacy-applicant@example.test', noticeVersion: '1', consent: 'yes' })) form.set(key, value)
  form.set('resume', new File(['Original legacy resume'], 'legacy.txt', { type: 'text/plain' }))
  assert.equal((await send('/embed/jobs/' + post.slug, form)).status, 200)
  const after = await state(), person = after.candidates.find(c => c.email === 'legacy-applicant@example.test')
  assert.ok(after.applications.some(a => a.candidate === person.id && a.vacancy === postJob.id && a.post === post.id))
  // Another source can keep its own host-page parameter, even when its ID matches Greenhouse's.
  await run('legacy-link', { ...map, source: 'workable', vacancy: v.id, post: null, sourceUrl: 'https://apply.workable.com/example/j/old-42/' })
  const genericPath = '/embed/jobs?legacy_source=workable&legacy_job=old-42&utm_source=old-workable'
  const generic = await send(genericPath)
  assert.equal(generic.status, 302)
  assert.equal(generic.headers.get('location'), '/embed/jobs/' + v.slug + '?utm_source=old-workable')
  assert.equal(generic.headers.get('cache-control'), 'no-store')
  const beforeInvalid = await state()
  for (const query of [
    'legacy_source=unknown&legacy_job=old-42', 'legacy_source=workable', 'legacy_job=old-42',
    'legacy_source=workable&legacy_job=old-42&legacy_job=another',
    'legacy_source=workable&legacy_source=greenhouse&legacy_job=old-42',
    'legacy_source=workable&legacy_job=old-42&gh_jid=old-42', 'gh_jid=old-42&gh_jid=another',
  ]) {
    const invalid = await send('/embed/jobs?' + query)
    assert.equal(invalid.status, 404, query)
    assert.equal(invalid.text, (await send('/embed/jobs?gh_jid=unknown')).text)
    assert.equal(invalid.headers.get('cache-control'), 'no-store')
  }
  assert.deepEqual(await state(), beforeInvalid, 'invalid legacy selectors change no hiring or audit records')
  const workableForm = new FormData()
  for (const [key, value] of Object.entries({ name: 'Workable legacy applicant', email: 'workable-legacy@example.test', noticeVersion: '1', consent: 'yes', utm_source: 'old-workable' })) workableForm.set(key, value)
  assert.equal((await send('/embed/jobs/' + v.slug, workableForm)).status, 200)
  const workableState = await state(), workablePerson = workableState.candidates.find(c => c.email === 'workable-legacy@example.test')
  assert.ok(workableState.applications.some(a => a.candidate === workablePerson.id && a.vacancy === v.id && a.campaign.utm_source === 'old-workable'))
  await run('unpublish', { id: v.id, reason: 'Pause Workable destination' })
  assert.equal((await send(genericPath)).text, (await send('/embed/jobs?gh_jid=unknown')).text)
  await run('publish', { id: v.id })
  await run('legacy-link', { ...map, sourceId: 'job-only', vacancy: v.id, post: null })
  assert.equal((await send('/jobs/legacy/greenhouse/job-only')).headers.get('location'), '/jobs/' + v.slug)
  const unrelated = await h.member('legacy-other@example.test', ['manager'])
  assert.deepEqual((await send('/api/lodge/reports/cutover', undefined, unrelated)).value.mappings, [])
  await run('hiring-team', { id: postJob.id, recruiters: ['legacy-other@example.test'] })
  assert.ok((await send('/api/lodge/reports/cutover', undefined, unrelated)).value.mappings.some(m => m.sourceId === map.sourceId))
  await run('hiring-team', { id: postJob.id })
  assert.deepEqual((await send('/api/lodge/reports/cutover', undefined, unrelated)).value.mappings, [], 'removing the job role removes its report immediately')
  assert.equal((await send('/api/lodge/command/legacy-link', { ...map, remove: true }, unrelated)).status, 403)
  assert.equal((await send('/api/lodge/command/legacy-link', { ...map, sourceUrl: 'javascript:alert(1)' }, owner)).status, 400)
  assert.equal((await send('/api/lodge/command/legacy-link', { ...map, sourceUrl: 'not a URL' }, owner)).status, 400)
  const report = (await send('/api/lodge/reports/cutover', undefined, owner)).value
  assert.ok(report.mappings.some(m => m.sourceUrl === map.sourceUrl && m.destination === '/jobs/' + post.slug))
  assert.equal(report.reconciliation.status, 'unavailable', 'a map is not proof that boards or source intake have reconciled')
  const refused = async () => {
    const unknown = await send('/jobs/legacy/greenhouse/unknown'), known = await send('/jobs/legacy/greenhouse/old-42')
    assert.equal(known.status, 404); assert.equal(known.text, unknown.text)
    assert.ok(!known.text.includes(postJob.title) && !known.text.includes(post.title))
    const embeddedUnknown = (await send('/embed/jobs?gh_jid=unknown')).text
    assert.equal((await send('/embed/jobs?gh_jid=old-42')).text, embeddedUnknown)
    assert.equal((await send('/embed/jobs?legacy_source=greenhouse&legacy_job=old-42')).text, embeddedUnknown)
  }
  await run('post-status', { vacancy: postJob.id, post: post.id, status: 'paused' }); await refused()
  await run('post-status', { vacancy: postJob.id, post: post.id, status: 'live' })
  await run('vacancy-privacy', { id: postJob.id, confidential: true, publicTitle: 'A neutral role', namedPeople: [] }); await refused()
  await run('vacancy-privacy', { id: postJob.id, confidential: false, namedPeople: [] })
  await run('vacancy-internal', { id: postJob.id, internalOnly: true }); await refused()
  await run('vacancy-internal', { id: postJob.id, internalOnly: false })
  await run('unpublish', { id: postJob.id, reason: 'Pause intake' }); await refused()
  await run('publish', { id: postJob.id })
  await run('close-vacancy', { id: postJob.id, reason: 'Hiring complete' }); await refused()
  await run('legacy-link', { ...map, remove: true })
  const remaining = (await send('/api/lodge/reports/cutover', undefined, owner)).value.mappings
  assert.ok(!remaining.some(m => m.source === map.source && m.sourceId === map.sourceId))
  assert.ok(remaining.some(m => m.source === 'workable' && m.sourceId === map.sourceId), 'removing one source leaves the other source mapping intact')
  assert.equal((await send(genericPath)).status, 302)
}

// MIG-009: existing embedded careers links select the mapped source/job and accept an application.




export async function legacyPage(browser, { lodge, site, run, state, ownerEmail, evidence }) {
  // Matching IDs on different sources must never choose the other source's job.
  const oldId = 'previous-crew-42'
  const routes = [
    { source: 'greenhouse', job: await legacyJob(run, state, ownerEmail, 'Cutover crew lead'), query: 'gh_jid=' + oldId },
    { source: 'workable', job: await legacyJob(run, state, ownerEmail, 'Workable crew lead'), query: 'legacy-source=workable&legacy-parameter=wjob&wjob=' + oldId + '&gh_jid=' + oldId },
  ]
  for (const route of routes) {
    const { source, job } = route
    await run('legacy-link', { source, sourceId: oldId, sourceUrl: `https://source.example.test/${source}/${oldId}`, vacancy: job.id })
    for (const width of browserWidths) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        const page = await context.newPage(), errors = []
        page.on('pageerror', e => errors.push(e.message))
        await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&${route.query}&utm_source=old-${source}`)
        const frame = page.frameLocator('iframe[title="Open roles"]')
        await frame.getByRole('heading', { name: job.title, exact: true }).waitFor()
        await frame.getByLabel('Full name').fill(`Cutover ${source} Applicant ${width}`)
        const email = `cutover-${source}-${width}@example.test`
        await frame.getByLabel('Email', { exact: true }).fill(email)
        await frame.getByLabel('I have read privacy notice', { exact: false }).check()
        assert.equal(await frame.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false, `legacy form fits ${width}`)
        await page.screenshot({ path: join(evidence, `legacy-${source}-embed-${width}.png`), fullPage: true })
        await frame.getByRole('button', { name: 'Submit application' }).click()
        await frame.getByRole('heading', { name: 'Application received' }).waitFor()
        const w = await state(), candidate = w.candidates.find(c => c.email === email)
        assert.ok(w.applications.some(a => a.candidate === candidate.id && a.vacancy === job.id && a.campaign.utm_source === 'old-' + source))
        await page.screenshot({ path: join(evidence, `legacy-${source}-receipt-${width}.png`), fullPage: true })
        await page.goto(`${lodge}/jobs/legacy/${source}/${oldId}`)
        await page.getByRole('heading', { name: job.title, exact: true }).waitFor()
        assert.equal(new URL(page.url()).pathname, '/jobs/' + job.slug)
        await page.screenshot({ path: join(evidence, `legacy-${source}-hosted-${width}.png`), fullPage: true })
        if (source === 'workable') {
          // A configured snippet with no old job parameter remains an ordinary job board.
          await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&legacy-source=workable&legacy-parameter=wjob&gh_jid=${oldId}`)
          await frame.getByRole('heading', { name: /^Open roles/ }).waitFor()
          await frame.getByRole('link', { name: job.title, exact: true }).waitFor()
          // Repeated IDs are ambiguous rather than a request to choose the first one.
          await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&legacy-source=workable&legacy-parameter=wjob&wjob=${oldId}&wjob=other`)
          await frame.getByRole('heading', { name: 'This role is not available' }).waitFor()
          assert.ok(!(await frame.locator('body').textContent()).includes(job.title))
          await page.screenshot({ path: join(evidence, `legacy-${source}-ambiguous-${width}.png`), fullPage: true })
        }
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
  }
  // Neutral confidential listings cannot be disclosed through any old source's link.
  for (const { source, job, query } of routes) {
    await run('vacancy-privacy', { id: job.id, confidential: true, publicTitle: 'Neutral listing', namedPeople: [] })
    for (const width of browserWidths) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } })
      try {
        const page = await context.newPage()
        assert.equal((await page.goto(`${lodge}/jobs/legacy/${source}/${oldId}`)).status(), 404)
        await page.getByRole('link', { name: 'See open roles' }).waitFor()
        assert.ok(!(await page.textContent('body')).includes(job.title))
        assert.equal(await page.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false)
        await page.screenshot({ path: join(evidence, `legacy-${source}-unavailable-${width}.png`), fullPage: true })
        await page.goto(`${site}/embed-host?lodge=${encodeURIComponent(lodge)}&${query}`)
        const frame = page.frameLocator('iframe[title="Open roles"]')
        await frame.getByRole('heading', { name: 'This role is not available' }).waitFor()
        assert.ok(!(await frame.locator('body').textContent()).includes(job.title))
        assert.equal(await frame.locator('html').evaluate(el => el.scrollWidth > innerWidth + 1), false)
        await page.screenshot({ path: join(evidence, `legacy-${source}-embed-unavailable-${width}.png`), fullPage: true })
      } finally { await context.close() }
    }
    await run('legacy-link', { source, sourceId: oldId, remove: true })
  }
}
