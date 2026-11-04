import assert from 'node:assert/strict'
import { DOMParser } from '@xmldom/xmldom'
import { businessHarness } from './harness.mjs'
import { RANGE, RUBRIC } from './hiring-fixture.mjs'

// Requirements: https://learn.microsoft.com/en-us/linkedin/talent/job-postings/xml-feeds-development-guide
// and https://docs.indeed.com/job-sync-xml/xml-feed . These checks inspect actual served XML, independently of its serializer.
function xml(response, board) {
  assert.equal(response.status, 200, response.text)
  assert.match(response.headers.get('content-type'), /application\/xml/)
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.equal(response.headers.get('etag'), null)
  const errors = []
  const doc = new DOMParser({ errorHandler: { warning: e => errors.push(e), error: e => errors.push(e), fatalError: e => errors.push(e) } }).parseFromString(response.text, 'application/xml')
  assert.deepEqual(errors, [])
  assert.equal(doc.documentElement.tagName, 'source')
  assert.equal(doc.getElementsByTagName('script').length, 0)
  const rows = Array.from(doc.getElementsByTagName('job'))
  const required = board === 'linkedin' ? ['partnerJobId', 'title', 'description', 'company', 'companyId', 'applyUrl', 'posterEmail', 'location'] : ['title', 'date', 'referencenumber', 'requisitionid', 'url', 'company', 'sourcename', 'city', 'state', 'country', 'email', 'description', 'salary', 'jobtype']
  for (const job of rows) {
    const nationwide = board === 'indeed' && value(job, 'remotetype') === 'Fully remote' && value(job, 'city') === 'remote'
    for (const field of required) {
      if (nationwide && field === 'state') assert.equal(value(job, field), '', 'a nationwide remote location has no invented state')
      else assert.ok(value(job, field).trim(), 'Required ' + board + ' field: ' + field)
    }
    const url = new URL(value(job, board === 'linkedin' ? 'applyUrl' : 'url'))
    assert.equal(url.searchParams.get('feed'), board)
    assert.equal(url.searchParams.get('source'), board === 'indeed' ? 'Indeed' : 'LinkedIn')
    assert.match(url.pathname, /^\/jobs\//)
    if (board === 'linkedin') {
      assert.ok(value(job, 'partnerJobId').length <= 40)
      assert.match(value(job, 'companyId'), /^[1-9][0-9]*$/)
      assert.ok(value(job, 'description').length >= 100)
    } else {
      assert.ok(Number.isFinite(Date.parse(value(job, 'date'))))
      assert.equal(value(job, 'country'), 'US')
      if (!nationwide) assert.match(value(job, 'state'), /^[A-Z]{2}$/)
    }
  }
  const ids = rows.map(j => value(j, board === 'linkedin' ? 'partnerJobId' : 'referencenumber'))
  assert.equal(new Set(ids).size, ids.length, 'each post or location is an independent stable instance')
  return rows
}
const value = (job, tag) => job.getElementsByTagName(tag)[0]?.textContent ?? ''

export async function checkFreeFeeds() {
  const calls = []
  const h = await businessHarness({ clock: '2026-11-04T12:00:00.000Z', outboundService: req => { calls.push(req.url); return new Response('No provider configured', { status: 503 }) } })
  const { command: cmd, state, send } = h
  try {
    const ownerEmail = (await state()).actor.email
    const managerEmail = ['synthetic-lodge-manager', 'example.test'].join('@')
    const manager = await h.member(managerEmail, ['manager'], 'Synthetic Lodge Manager')
    const a = await cmd('office', { name: 'Denver, CO' }), b = await cmd('office', { name: 'New York City, NY' })
    const hostile = 'Maintain safe operations and carefully document every job-related decision. Work with the team to plan clear schedules and communicate progress. Hostile text: <script>alert("x")</script> & ]]> remains literal.'
    const open = async (title, offices, extra = {}) => {
      let v = await cmd('vacancy', { title, description: hostile, officeId: offices[0].id, locations: offices.slice(1).map(x => x.id), headcount: 1, compensation: RANGE, benefits: 'Health & bonus <reviewed>', payRanges: offices.map((o, i) => ({ officeId: o.id, compensation: { currency: 'USD', min: 6000000 + i * 1000000, max: 8000000 + i * 1000000, period: 'year' } })), manager: ownerEmail, ...extra })
      await cmd('rubric', { id: v.id, criteria: RUBRIC })
      await cmd('interview-plan', { id: v.id, plan: [{ name: 'Safety', stageName: 'Interview' }] })
      const approval = await cmd('request-vacancy-approval', { id: v.id, approver: ownerEmail })
      await cmd('decide-approval', { id: approval.id, version: approval.version, decision: 'approved', reason: 'Reviewed exact public terms' })
      return cmd('publish', { id: v.id })
    }
    let first = await open('Synthetic operations', [a, b]), second = await open('Synthetic field team', [a])
    const configure = async (v, post, board, overrides = {}, cookie) => {
      const job = (await state()).vacancies.find(x => x.id === v.id)
      const target = (await state()).freeFeedSettings.find(x => x.vacancy === job.id).targets.find(x => x.post === post)
      const current = target.boards.find(x => x.board === board).config
      return send('/api/lodge/command/free-feed', { vacancy: v.id, post, board, source: target.source, version: current?.version ?? 0, enabled: true, reviewed: true,
        companyName: 'Synthetic Lodge Employer', companyUrl: 'https://www.example.test', companyId: '123456789', posterEmail: ownerEmail,
        locations: (post ? job.posts.find(x => x.id === post).locations : [job.officeId, ...(job.locations ?? [])]).map(id => ({ officeId: id, city: id === a.id ? 'Denver' : 'New York City', state: id === a.id ? 'CO' : 'NY', country: 'US' })), creditKind: 'sourcer', creditWho: ownerEmail, ...overrides }, cookie ?? h.owner)
    }
    const feed = async board => xml(await send('/careers/feeds/' + board + '.xml'), board)
    assert.equal((await feed('linkedin')).length, 0, 'no implicit opt-in')
    assert.equal((await configure(first, null, 'linkedin', { companyId: '' })).status, 400, 'do not invent a Company Page')
    assert.equal((await configure(first, null, 'indeed', { locations: [] })).status, 400)
    assert.equal((await configure(first, null, 'indeed', { reviewed: false })).status, 409)
    assert.equal((await configure(first, null, 'indeed', { source: 'stale-source' })).status, 409)
    assert.equal((await configure(first, null, 'indeed', {}, manager)).status, 403)
    assert.equal((await configure(first, null, 'indeed', { companyUrl: 'not a URL' })).status, 400)
    const noDisclosure = (await state()).vacancies.find(v => v.id === first.id).freeFeeds
    assert.equal(noDisclosure, undefined, 'rejected configuration attempts changed nothing')
    for (const v of [first, second]) for (const board of ['linkedin', 'indeed']) assert.equal((await configure(v, null, board)).status, 200)
    const linkedin = await feed('linkedin'), indeed = await feed('indeed')
    assert.equal(linkedin.length, 2)
    assert.equal(indeed.length, 3, 'Indeed represents each approved location separately')
    const firstLinked = linkedin.find(j => value(j, 'title') === first.title)
    assert.deepEqual(Array.from(firstLinked.getElementsByTagName('alternateLocation')).map(x => x.textContent), ['Denver, CO, US', 'New York City, NY, US'])
    assert.equal(firstLinked.getElementsByTagName('salary').length, 0, 'unequal locations never acquire one shared numeric salary')
    for (const row of [firstLinked, ...indeed.filter(j => value(j, 'requisitionid') === first.id)]) {
      const content = value(row, 'description')
      assert.ok(content.includes('Pay for Denver, CO: $60,000–$80,000 a year'))
      assert.ok(content.includes('Pay for New York City, NY: $70,000–$90,000 a year'))
      assert.ok(content.includes('Health &amp; bonus &lt;reviewed&gt;'))
      assert.ok(content.includes('&lt;script&gt;') && !content.includes('<script>'), 'hostile HTML is literal text')
      assert.ok(content.includes(']]&gt;'), 'CDATA terminators remain exact literal description text')
    }
    assert.deepEqual(indeed.filter(j => value(j, 'requisitionid') === first.id).map(j => value(j, 'salary')).sort(), ['$60000 - $80000 per year', '$70000 - $90000 per year'])
    assert.match((await state()).freeFeedSettings.find(v => v.vacancy === first.id).targets[0].boards[0].status, /Feed served, listing not confirmed/)

    // Two independent posts replace the job entry only on their selected destinations.
    first = await cmd('job-post', { vacancy: first.id, title: 'Synthetic Denver post', description: hostile, locations: [a.id], destinations: ['careers', 'linkedin', 'indeed'] })
    const p1 = first.posts.at(-1)
    first = await cmd('job-post', { vacancy: first.id, title: 'Synthetic New York post', description: hostile, locations: [b.id], destinations: ['linkedin', 'indeed'] })
    const p2 = first.posts.at(-1)
    for (const p of [p1, p2]) {
      await cmd('post-status', { vacancy: first.id, post: p.id, status: 'live' })
      for (const board of ['linkedin', 'indeed']) assert.equal((await configure(first, p.id, board)).status, 200)
    }
    assert.equal((await send('/jobs/' + p2.slug)).status, 404, 'feed-only posts stay off the careers list')
    assert.equal((await send('/jobs/' + p2.slug + '?feed=linkedin')).status, 200, 'a selected feed post has its own hosted application even without the careers-list destination')
    const posts = await feed('linkedin')
    assert.equal(posts.length, 3)
    assert.ok(!posts.some(j => value(j, 'title') === 'Synthetic operations'))
    const ownPay = value(posts.find(j => value(j, 'title') === p1.title), 'description')
    assert.ok(ownPay.includes('$60,000–$80,000') && !ownPay.includes('$70,000–$90,000'))
    assert.equal(value(posts.find(j => value(j, 'title') === p1.title), 'amount'), '60000')
    const stableId = value(posts.find(j => value(j, 'title') === p1.title), 'partnerJobId')

    // Click the actual served URLs; source registration occurs at intake, not feed generation.
    assert.ok(!(await state()).sources.some(s => ['LinkedIn Limited Listing', 'Indeed (organic)'].includes(s.name)))
    for (const board of ['linkedin', 'indeed']) {
      const rows = await feed(board), row = rows.find(j => value(j, 'title') === p1.title)
      const url = new URL(value(row, board === 'linkedin' ? 'applyUrl' : 'url'))
      const path = url.pathname + url.search
      const page = await send(path)
      assert.equal(page.status, 200)
      assert.ok(page.text.includes('Synthetic Denver post'))
      const action = page.text.match(/<form method="post" enctype="multipart\/form-data" action="([^"]+)"/)[1].replaceAll('&amp;', '&')
      assert.equal(new URL(action, h.origin).searchParams.get('feed'), board)
      const email = ['synthetic-lodge-' + board, 'example.test'].join('@')
      const fields = { submissionKey: 'synthetic-lodge-' + board, name: 'Synthetic Feed Candidate', email, noticeVersion: String((await state()).business.notices.at(-1).version), consent: 'yes' }
      const form = () => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); return f }
      const applied = await send(action, form())
      assert.equal(applied.status, 200, applied.text)
      const receipt = applied.text.match(/LDG-[A-F0-9]{8}/)[0]
      await h.restart()
      const repeat = await send(action, form())
      assert.equal(repeat.status, 200, repeat.text)
      assert.ok(repeat.text.includes(receipt))
      const w = await state(), candidate = w.candidates.find(c => c.email === email)
      const apps = w.applications.filter(a => a.candidate === candidate.id)
      assert.equal(apps.length, 1, 'replaying the same submission after restart creates no duplicate')
      assert.deepEqual([apps[0].post, apps[0].source, apps[0].credit.kind, apps[0].credit.who], [p1.id, board === 'linkedin' ? 'LinkedIn Limited Listing' : 'Indeed (organic)', 'sourcer', ownerEmail])
      assert.deepEqual(apps[0].sourceProvenance, { kind: 'declared-feed-link', board, verifiedProviderReferral: false, configurationVersion: 1 })
      assert.equal(apps[0].campaign.attribution, 'declared-feed-link')
      assert.ok(w.sources.some(s => s.name === apps[0].source && s.type === 'job-board' && s.automatic))
      assert.equal((await send(action, (() => { const f = form(); f.set('name', 'Changed capture'); return f })())).status, 409)
    }
    assert.equal((await send('/jobs/' + p1.slug + '?feed=unknown')).status, 404)
    await cmd('job-post', { vacancy: first.id, post: p1.id, title: 'Edited Denver post', description: hostile + ' Employer edited.', locations: [a.id], destinations: ['careers', 'linkedin', 'indeed'] })
    assert.ok(!(await feed('linkedin')).some(j => value(j, 'partnerJobId') === stableId), 'edits withhold until their exact content is reviewed again')
    for (const board of ['linkedin', 'indeed']) assert.equal((await configure(first, p1.id, board)).status, 200)
    assert.equal(value((await feed('linkedin')).find(j => value(j, 'title') === 'Edited Denver post'), 'partnerJobId'), stableId)
    const current = (await state()).vacancies.find(v => v.id === first.id).freeFeeds.find(x => x.board === 'linkedin' && x.post === p1.id)
    assert.equal(current.versions.length, 2)
    await cmd('post-status', { vacancy: first.id, post: p1.id, status: 'paused' })
    assert.ok(!(await feed('indeed')).some(j => value(j, 'title') === 'Edited Denver post'))
    assert.equal((await send('/jobs/' + p1.slug + '?feed=indeed')).status, 404)
    await cmd('post-status', { vacancy: first.id, post: p1.id, status: 'live' })
    assert.ok((await feed('indeed')).some(j => value(j, 'title') === 'Edited Denver post'))
    await cmd('post-status', { vacancy: first.id, post: p2.id, status: 'closed' })
    assert.ok(!(await feed('linkedin')).some(j => value(j, 'title') === p2.title))
    for (const [op, body] of [['vacancy-privacy', { confidential: true }], ['vacancy-internal', { internalOnly: true }]]) {
      await cmd(op, { id: second.id, ...body })
      for (const board of ['linkedin', 'indeed']) assert.ok(!(await feed(board)).some(j => value(j, 'title') === second.title))
      await cmd(op, { id: second.id, confidential: false, internalOnly: false })
    }
    assert.equal((await configure(second, null, 'indeed', { enabled: false, reviewed: false, locations: [] })).status, 200)
    assert.ok(!(await feed('indeed')).some(j => value(j, 'title') === second.title), 'explicit opt-out is immediate without re-review')
    await cmd('pay-rules', { rules: [{ place: 'Colorado', reviewedOn: '2026-01-01', benefitsRequired: true, rangeRequired: true }] })
    assert.equal((await feed('linkedin')).length, 0, 'changed pay rules invalidate current exact feed review')
    for (const board of ['linkedin', 'indeed']) assert.equal((await configure(first, p1.id, board)).status, 200)
    const firstDate = value((await feed('indeed')).find(j => value(j, 'title') === 'Edited Denver post'), 'date')
    await h.setTime('2026-11-05T12:00:00.000Z')
    await cmd('unpublish', { id: first.id, reason: 'Native feed removal' })
    assert.equal((await feed('linkedin')).length, 0)
    await cmd('publish', { id: first.id })
    assert.equal((await feed('linkedin')).length, 1)
    assert.equal(value((await feed('indeed')).find(j => value(j, 'title') === 'Edited Denver post'), 'date'), firstDate, 'republishing preserves the original feed date')
    await cmd('close-vacancy', { id: first.id, reason: 'Role filled' })
    assert.equal((await feed('linkedin')).length, 0)
    assert.equal((await send('/jobs/' + p1.slug + '?feed=linkedin')).status, 404)

    // An incomplete language draft stays editable and never enters a public feed.
    const french = await cmd('job-post', { vacancy: second.id, title: 'Synthetic French draft', description: 'Description française', language: 'fr', locations: [a.id], destinations: ['careers', 'linkedin', 'indeed'] })
    const draft = french.posts.at(-1)
    const draftState = await send('/api/lodge/state', undefined, h.owner)
    assert.equal(draftState.status, 200, draftState.text)
    const settings = draftState.value.freeFeedSettings.find(x => x.vacancy === second.id).targets.find(x => x.post === draft.id)
    assert.equal(settings.source, null, 'a missing translation supplies no feed review token')
    assert.equal(settings.content.pay, '', 'a draft never substitutes source-language applicant pay')
    await cmd('job-post', { vacancy: second.id, post: draft.id, title: 'Edited French draft', description: 'Description française modifiée', language: 'fr', locations: [a.id], destinations: ['careers', 'linkedin', 'indeed'] })
    assert.equal((await send('/api/lodge/command/post-status', { vacancy: second.id, post: draft.id, status: 'live' }, h.owner)).status, 409)
    assert.equal((await configure(second, draft.id, 'linkedin')).status, 409)
    for (const board of ['linkedin', 'indeed']) assert.ok(!(await feed(board)).some(j => value(j, 'title') === 'Edited French draft'))
    await cmd('post-status', { vacancy: second.id, post: draft.id, status: 'closed' })
    console.log('PROBE ATTR-003 French draft: untranslated post -> workspace HTTP 200, draft edits save, publication and feed opt-in refused with HTTP 409')

    const remoteOffice = await cmd('office', { name: 'Remote US' })
    const remote = await open('Synthetic nationwide remote job', [remoteOffice], { workMode: 'remote' })
    const location = (city = '', state = '', officeId = remoteOffice.id) => [{ officeId, city, state, country: 'US' }]
    for (const board of ['linkedin', 'indeed']) {
      assert.equal((await configure(remote, null, board, { locations: location('Remote', 'NY') })).status, 400, 'remote cannot be combined with a real state')
      assert.equal((await configure(remote, null, board, { locations: location('Denver', 'remote') })).status, 400, 'remote cannot be combined with a real city')
      assert.equal((await configure(second, null, board, { locations: location('', '', a.id) })).status, 400, 'onsite jobs still require a real city and state')
    }
    assert.equal((await state()).vacancies.find(v => v.id === remote.id).freeFeeds, undefined, 'invalid remote metadata creates no configuration')
    let remoteId
    for (const [city, region] of [['Remote', 'Remote'], ['remote', ''], ['', 'REMOTE'], ['', '']]) {
      for (const board of ['linkedin', 'indeed']) {
        assert.equal((await configure(remote, null, board, { locations: location(city, region) })).status, 200)
        const row = (await feed(board)).find(j => value(j, 'title') === remote.title)
        assert.ok(row, 'the approved nationwide job is served')
        if (board === 'indeed') {
          assert.deepEqual(['city', 'state', 'country', 'remotetype', 'salary'].map(tag => value(row, tag)), ['remote', '', 'US', 'Fully remote', '$60000 - $80000 per year'])
          remoteId ??= value(row, 'referencenumber')
          assert.equal(value(row, 'referencenumber'), remoteId, 'equivalent reviewed remote metadata keeps its job identifier')
        } else {
          assert.equal(value(row, 'location'), 'US')
          assert.equal(value(row, 'alternateLocation'), 'US')
          assert.equal(value(row, 'workplaceTypes'), 'Remote')
        }
        const url = new URL(value(row, board === 'indeed' ? 'url' : 'applyUrl'))
        const page = await send(url.pathname + url.search)
        assert.equal(page.status, 200)
        assert.ok(page.text.includes('Remote US'))
      }
    }
    await cmd('close-vacancy', { id: remote.id, reason: 'Remote role filled' })
    for (const board of ['linkedin', 'indeed']) assert.ok(!(await feed(board)).some(j => value(j, 'title') === remote.title))
    console.log('PROBE ATTR-003 nationwide remote: documented remote and country-only US metadata -> HTTP 200, Indeed Fully remote marker and LinkedIn US location; Remote, NY -> HTTP 400 without mutation')
    await h.setTime('2027-01-01T12:00:00.000Z')
    assert.equal((await send('/api/lodge/command/free-feed', { vacancy: second.id, board: 'linkedin', enabled: true }, h.owner)).status, 401, 'a genuinely expired native session cannot revive or change feed configuration')
    assert.equal((await feed('linkedin')).length, 0, 'an expired credential changes no public entry')
    assert.equal(calls.length, 0, 'native serving and submission never contact a board')
    console.log('PROBE ATTR-003 native feeds: two approved jobs and separate posts -> valid current XML, exact escaped content, per-location pay and stable IDs')
    console.log('PROBE ATTR-003 exclusions: edits, rules, pause, confidential, internal, unpublish and close -> next public response withholds listing')
    console.log('PROBE ATTR-003 attribution: served links and restarted replay -> post, declared board source, automatic job-board source and CRM credit retained, one application')
  } finally { await h.close() }
}
