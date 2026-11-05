import assert from 'node:assert/strict'
import { businessHarness } from './harness.mjs'

export const structuredListings = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]))
const visible = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

/** One native security and publication journey, using genuine Worker commands and public HTML. */
export async function checkOfficeJobPosting() {
  const outbound = []
  const h = await businessHarness({ clock: '2026-11-05T12:00:00Z', outboundService: request => { outbound.push(request.url); return new Response('Unexpected provider call', { status: 502 }) } })
  const { command: cmd, state, send } = h
  try {
    const ownerEmail = (await state()).actor.email
    const managerEmail = 'synthetic-lodge-1' + '@' + 'example.test', outsiderEmail = 'synthetic-lodge-2' + '@' + 'example.test'
    const manager = await h.member(managerEmail, ['manager'], 'Synthetic office manager')
    const outsider = await h.member(outsiderEmail, ['manager'], 'Synthetic other manager')
    const office = await cmd('office', { name: 'Denver, CO' }), other = await cmd('office', { name: 'Aurora, CO' })
    const settings = await cmd('permission-level', { name: 'Synthetic settings', permissions: ['settings'] })
    const limited = await cmd('permission-level', { name: 'Synthetic limited', permissions: ['export'] })
    const grant = (id = settings.id, offices = [office.id]) => cmd('member-org', { email: managerEmail, grantOffices: offices, grantLevels: Object.fromEntries(offices.map(o => [o, id])) })
    await grant()
    await cmd('member-org', { email: outsiderEmail, grantOffices: [other.id], grantLevels: { [other.id]: settings.id } })
    let job = await cmd('vacancy', { title: 'Synthetic operations role', officeId: office.id, locations: [other.id], manager: ownerEmail, headcount: 1, employmentType: 'part-time', compensation: { currency: 'USD', min: 1955, max: 2575, period: 'hour' }, payRanges: [
      { officeId: office.id, compensation: { currency: 'USD', min: 1955, max: 2575, period: 'hour' } },
      { officeId: other.id, compensation: { currency: 'USD', min: 2250, max: 3075, period: 'hour' } },
    ], benefits: 'Paid leave; no bonus.' })
    await cmd('rubric', { id: job.id, criteria: [{ name: 'Operations', description: 'Explains safe operations' }] })
    await cmd('interview-plan', { id: job.id, plan: [{ name: 'Operations discussion', stageName: 'Interview' }] })
    const approve = async () => {
      const asked = await cmd('request-vacancy-approval', { id: job.id, approver: ownerEmail })
      await cmd('decide-approval', { id: asked.id, version: asked.version, decision: 'approved', reason: 'Exact location terms reviewed' })
    }
    await approve(); job = await cmd('publish', { id: job.id })
    const hostile = 'Synthetic </script><script>globalThis.syntheticLodge=1</script> & "role"'
    const description = 'Safe operations <img src=x onerror=globalThis.syntheticLodge=2> & careful work.\u2028Next shift.'
    job = await cmd('job-post', { vacancy: job.id, title: hostile, description, locations: [office.id], destinations: ['careers', 'embed', 'api'] })
    let post = job.posts.at(-1)
    await cmd('post-status', { vacancy: job.id, post: post.id, status: 'live' })
    const path = '/jobs/' + post.slug
    const info = async cookie => (await state(cookie)).vacancies.find(v => v.id === job.id).jobPostingSettings.find(x => x.post === post.id)
    const meta = { employerName: 'Example Builders', employerUrl: 'https://employer.example.test/', datePosted: '2026-11-01', validThrough: '2027-01-31', employmentType: 'part-time', addresses: [{ officeId: office.id, streetAddress: '100 Synthetic Street', addressLocality: 'Denver', addressRegion: 'CO', postalCode: '80202', addressCountry: 'US' }] }
    const review = async (cookie = h.owner, metadata = meta, status = 200) => cmd('review-job-posting', { vacancy: job.id, post: post.id, source: (await info(h.owner)).source, metadata, reviewed: true }, cookie, status)
    const rows = async () => (await h.db.prepare('SELECT kind,id,revision,value FROM l_records ORDER BY kind,id').all()).results
    const publicPage = async () => { const page = await send(path); assert.equal(page.status, 200); return page.text }
    const assertPublished = async () => {
      const html = await publicPage(), data = structuredListings(html)
      assert.equal(data.length, 1, 'one JobPosting on the selected page')
      const posting = data[0], text = visible(html)
      assert.deepEqual([posting['@type'], posting.title, posting.description, posting.employmentType], ['JobPosting', hostile, description, 'PART_TIME'])
      assert.deepEqual(posting.baseSalary, { '@type': 'MonetaryAmount', currency: 'USD', value: { '@type': 'QuantitativeValue', minValue: 19.55, maxValue: 25.75, unitText: 'HOUR' } })
      assert.deepEqual(posting.jobLocation, [{ '@type': 'Place', name: 'Denver, CO', address: { '@type': 'PostalAddress', streetAddress: '100 Synthetic Street', addressLocality: 'Denver', addressRegion: 'CO', postalCode: '80202', addressCountry: 'US' } }])
      assert.equal(posting.url, h.origin + path)
      assert.equal(posting.hiringOrganization.name, 'Example Builders')
      assert.equal(posting.hiringOrganization.sameAs, 'https://employer.example.test/')
      assert.equal(posting.datePosted, '2026-11-01')
      assert.equal(posting.validThrough, '2027-01-31T23:59:59Z')
      assert.equal(posting.jobBenefits, 'Paid leave; no bonus.')
      for (const shown of [hostile, description, 'Part-time', '$19.55–$25.75', '100 Synthetic Street', 'Denver', '80202', 'Example Builders', '2026-11-01', '2027-01-31', 'Paid leave; no bonus.']) assert.ok(text.includes(shown), 'visible approved content: ' + shown)
      assert.ok(!html.includes('<script>globalThis.syntheticLodge'), 'hostile text cannot terminate structured data')
      for (const secret of [managerEmail, ownerEmail, 'reviewedBy', 'grantOffices', 'grantLevels', 'Current human job settings authority', 'source":']) assert.ok(!html.includes(secret), 'public page reveals no authority provenance: ' + secret)
      return data
    }
    const assertWithheld = async () => assert.deepEqual(structuredListings(await publicPage()), [], 'ordinary page stays readable without markup')
    await assertWithheld()
    let before = await rows()
    await review(outsider, meta, 403)
    await review(h.owner, { ...meta, addresses: [] }, 400)
    await review(h.owner, { ...meta, employmentType: 'full-time' }, 400)
    await review(h.owner, { ...meta, datePosted: '2026-02-30' }, 400)
    await review(h.owner, { ...meta, employerUrl: 'not a URL' }, 400)
    assert.deepEqual(await rows(), before, 'incomplete metadata creates no review or audit')
    await review()
    const ownerMarkup = await assertPublished()
    const secondJob = await cmd('job-post', { vacancy: job.id, title: 'Synthetic Aurora role', description: 'Aurora safe operations.', locations: [other.id], destinations: ['careers'] })
    const secondPost = secondJob.posts.at(-1)
    await cmd('post-status', { vacancy: job.id, post: secondPost.id, status: 'live' })
    const secondInfo = (await state()).vacancies.find(v => v.id === job.id).jobPostingSettings.find(x => x.post === secondPost.id)
    await cmd('review-job-posting', { vacancy: job.id, post: secondPost.id, source: secondInfo.source, reviewed: true, metadata: { ...meta, addresses: [{ ...meta.addresses[0], officeId: other.id, addressLocality: 'Aurora', postalCode: '80010' }] } })
    const secondHtml = (await send('/jobs/' + secondPost.slug)).text
    assert.deepEqual(structuredListings(secondHtml).map(x => [x.title, x.baseSalary.value.minValue, x.baseSalary.value.maxValue]), [['Synthetic Aurora role', 22.5, 30.75]])
    assert.ok(visible(secondHtml).includes('$22.50–$30.75') && !visible(secondHtml).includes('$19.55–$25.75'), 'post header and structured salary both use its own office range')
    await assertWithheld(); await review(); await assertPublished()
    const unchangedRefusal = async (cookie, status = 403) => {
      const saved = await rows(), markup = structuredListings(await publicPage())
      await review(cookie, { ...meta, validThrough: '2027-02-01' }, status)
      assert.deepEqual(await rows(), saved, 'refused refresh changes no saved record')
      assert.deepEqual(structuredListings(await publicPage()), markup, 'refused refresh changes no public markup')
    }
    await unchangedRefusal(outsider)
    await review(manager)
    assert.deepEqual(await assertPublished(), ownerMarkup, 'office-only manager and owner publish identical approved content')
    assert.equal((await info(h.owner)).review.reviewedBy, managerEmail)
    assert.ok(!job.team?.recruiters?.includes(managerEmail) && job.manager !== managerEmail, 'no team assignment supplies the office authority')
    await h.restart(); await assertPublished()
    await grant(settings.id, [])
    await assertWithheld(); await unchangedRefusal(manager)
    await grant(); await assertPublished()
    await cmd('member', { email: managerEmail, name: 'Synthetic office manager', roles: ['manager'], active: false })
    await assertWithheld(); await unchangedRefusal(manager)
    await cmd('member', { email: managerEmail, name: 'Synthetic office manager', roles: ['manager'] })
    await assertPublished()
    await cmd('permission-level', { id: settings.id, name: settings.name, permissions: ['export'] })
    await assertWithheld(); await unchangedRefusal(manager)
    await cmd('permission-level', { id: settings.id, name: settings.name, permissions: ['settings'] })
    await assertPublished()
    // Member levels override role levels, which override combined place grants.
    await cmd('hiring-team', { id: job.id, recruiters: [managerEmail] })
    await cmd('job-levels', { id: job.id, roles: { recruiters: limited.id } })
    await unchangedRefusal(manager)
    await cmd('job-levels', { id: job.id, members: { [managerEmail]: settings.id }, roles: { recruiters: limited.id } })
    await review(manager); await assertPublished()
    await cmd('job-levels', { id: job.id, members: { [managerEmail]: limited.id }, roles: { recruiters: settings.id } })
    await assertWithheld(); await unchangedRefusal(manager)
    await cmd('job-levels', { id: job.id, roles: { recruiters: settings.id } })
    await grant(limited.id); await review(manager); await assertPublished()
    await cmd('job-levels', { id: job.id, roles: {} })
    await unchangedRefusal(manager)
    await grant(); await review(manager); await assertPublished()
    const beforeEdit = (await info(h.owner)).source
    await cmd('job-post', { vacancy: job.id, post: post.id, title: hostile, description: 'Synthetic revised description', locations: [office.id], destinations: ['careers', 'embed', 'api'] })
    await assertWithheld(); before = await rows()
    await cmd('review-job-posting', { vacancy: job.id, post: post.id, source: beforeEdit, metadata: meta, reviewed: true }, manager, 409)
    assert.deepEqual(await rows(), before)
    await cmd('job-post', { vacancy: job.id, post: post.id, title: hostile, description, locations: [office.id], destinations: ['careers', 'embed', 'api'] })
    await review(manager); await assertPublished()
    // A stale source token cannot refresh a review, even if the caller still has authority.
    const stale = (await info(h.owner)).source
    await cmd('office', { id: office.id, name: 'Denver renamed, CO' })
    await assertWithheld(); before = await rows()
    await cmd('review-job-posting', { vacancy: job.id, post: post.id, source: stale, metadata: meta, reviewed: true }, manager, 409)
    assert.deepEqual(await rows(), before)
    await cmd('office', { id: office.id, name: 'Denver, CO' }); await review(); await assertPublished()
    before = await rows(); await review(h.owner, { ...meta, addresses: [{ ...meta.addresses[0], postalCode: '' }] }, 400)
    assert.deepEqual(await rows(), before); await assertPublished()
    // Every existing exclusion remains authoritative and requires a fresh review after source edits.
    await cmd('post-status', { vacancy: job.id, post: post.id, status: 'paused' })
    assert.equal((await send(path)).status, 404)
    await cmd('post-status', { vacancy: job.id, post: post.id, status: 'live' }); await assertWithheld(); await review()
    await cmd('vacancy-privacy', { id: job.id, confidential: true })
    assert.equal((await send(path)).status, 404)
    await cmd('vacancy-privacy', { id: job.id, confidential: false }); await assertWithheld(); await review()
    await cmd('vacancy-internal', { id: job.id, internalOnly: true })
    assert.equal((await send(path)).status, 404)
    await cmd('vacancy-internal', { id: job.id, internalOnly: false }); await review()
    await cmd('pay-rules', { rules: [{ place: 'Denver', reviewedOn: '2026-01-01', benefitsRequired: true }] })
    await assertWithheld(); await review()
    // The otherwise valid public page is withheld when current pay rules fail.
    await cmd('unpublish', { id: job.id, reason: 'Synthetic terms revision' })
    assert.equal((await send(path)).status, 404)
    job = (await state()).vacancies.find(v => v.id === job.id)
    job = await cmd('vacancy', { ...job, benefits: '' })
    await approve()
    await cmd('pay-rules', { rules: [] }); await cmd('publish', { id: job.id }); await review()
    await cmd('pay-rules', { rules: [{ place: 'Denver', reviewedOn: '2026-01-01', benefitsRequired: true }] })
    assert.equal((await send(path)).status, 404)
    await cmd('pay-rules', { rules: [] })
    // An unequal multi-location salary is never silently represented by a shared amount.
    job = await cmd('job-post', { vacancy: job.id, title: 'Synthetic multi-office post', description: 'Safe operations.', locations: [office.id, other.id], destinations: ['careers'] })
    const multi = job.posts.at(-1)
    await cmd('post-status', { vacancy: job.id, post: multi.id, status: 'live' })
    const multiInfo = (await state()).vacancies.find(v => v.id === job.id).jobPostingSettings.find(x => x.post === multi.id)
    await cmd('review-job-posting', { vacancy: job.id, post: multi.id, source: multiInfo.source, reviewed: true, metadata: { ...meta, addresses: [...meta.addresses, { ...meta.addresses[0], officeId: other.id, addressLocality: 'Aurora' }] } }, h.owner, 409)
    assert.deepEqual(structuredListings((await send('/jobs/' + multi.slug)).text), [])
    await review(); await h.setTime('2027-02-01T00:00:00Z'); await assertWithheld()
    await h.setTime('2026-11-05T12:00:00Z'); await review()
    await cmd('post-status', { vacancy: job.id, post: post.id, status: 'closed' })
    assert.equal((await send(path)).status, 404)
    await cmd('close-vacancy', { id: job.id, reason: 'Synthetic closure' })
    assert.equal((await send('/jobs/' + multi.slug)).status, 404)
    assert.deepEqual(outbound, [], 'native review and publication make zero provider calls')
    console.log('PROBE ATTR-015 1: native owner and office-only manager review -> one accurate safely serialized JobPosting; exact content and cents agree')
    console.log('PROBE ATTR-015 2: revoke office grant, deactivate reviewer and remove settings -> markup absent, public page readable without authority disclosures')
    console.log('PROBE ATTR-015 3: unrelated office and ineffective member, team and place authority -> refused with identical saved state and markup')
  } finally { await h.close() }
}
