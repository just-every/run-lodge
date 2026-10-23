import { browserWidths } from './browser-widths.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { session } from './browser-journey.mjs'

/** CRM-001 is an API door: inspect its actual browser responses in each native session. */
export async function talentPage(browser, { root, origin, run, evidence }) {
  const kept = await run('candidate', { name: 'Riley Park', source: 'Job fair', consentBasis: 'talent-pool', talentPool: true, skills: 'Bluebeam residential takeoffs' })
  const expired = await run('candidate', { name: 'Ari Former', source: 'Job fair', consentBasis: 'talent-pool', talentPool: true, skills: 'Bluebeam' })
  await run('extend-retention', { candidate: expired.candidate.id, until: new Date(Date.now() - 86400000).toISOString().slice(0, 10), reason: 'Recorded retention ended' })
  await run('candidate', { name: 'Jo Quiet', source: 'Job fair', consentBasis: 'application', skills: 'Bluebeam' })
  const erased = await run('candidate', { name: 'Taylor Erased', source: 'Job fair', consentBasis: 'talent-pool', talentPool: true, skills: 'Bluebeam' })
  const owner = await session(browser, root, origin, 'owner', 1440)
  try {
    const deleted = await owner.context.request.post(origin + '/api/lodge/delete-candidate', { headers: { origin }, data: { candidate: erased.candidate.id, confirm: 'Taylor Erased', reason: 'Asked to be forgotten' } })
    assert.equal(deleted.status(), 200)
  } finally { await owner.context.close() }
  for (const width of browserWidths) {
    for (const as of ['owner', 'interviewer']) {
      const s = await session(browser, root, origin, as, width)
      try {
        const response = await s.page.goto(origin + '/api/lodge/talent?q=bluebeam')
        assert.equal(response.status(), as === 'owner' ? 200 : 403)
        const result = await response.json()
        if (as === 'owner') {
          assert.deepEqual(result.matches.map(m => m.candidate), [kept.candidate.id])
          assert.deepEqual(result.matches[0].evidence, { skills: 'Bluebeam residential takeoffs' })
          assert.equal(result.matches[0].permission.talentPool, true)
        } else assert.equal(result.matches, undefined)
        await s.page.screenshot({ path: join(evidence, `CRM-001-${as}-${width}.png`), fullPage: true })
      } finally { await s.context.close() }
    }
  }
}
