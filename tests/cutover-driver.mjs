// Shared HTTP and browser driver; each public-door journey retains its own assertions.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { BUSINESS, harness } from "./harness.mjs"
import { folderEntries, zip } from "./zip.mjs"
import { browserWidths } from "./browser-widths.mjs"
import { join } from "node:path"
import { current, session } from "./browser-journey.mjs"

// MIG-008 first slice through the public doors: the Workable kit's committed import, then the owner's mapped, previewed and
// approved cutover of its open applications into live jobs, the contact gate, ordinary work on the moved people, and undo.





const FIXTURE = 'fixtures/workable-full-export'

export async function checkCutover() {
 const h = await harness()
 try {
  const { command: cmd, send, state, owner } = h
  await cmd('business', BUSINESS)
  const morgan = await h.member('morgan@example.test', ['manager'], 'Morgan Lee')
  const pkg = { filename: 'workable-export.zip', base64: zip(await folderEntries(FIXTURE)).toString('base64') }
  const preview = await send('/api/lodge/import/preview', pkg, owner)
  assert.equal((await send('/api/lodge/import/commit', { ...pkg, fingerprint: preview.value.plan.fingerprint }, owner)).status, 200)
  const imported = title => state().then(s => s.vacancies.find(v => v.imported && v.title === title))
  const liveJob = async title => {
   const v = await cmd('vacancy', { title, location: 'Brooklyn, NY', headcount: 3, manager: 'morgan@example.test', compensation: { currency: 'USD', min: 9000000, max: 11000000, period: 'year' } })
   await cmd('rubric', { id: v.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
   await cmd('interview-plan', { id: v.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
   return (await state()).vacancies.find(x => x.id === v.id)
  }
  const stageId = (job, name) => job.stages.find(s => s.name === name).id
  const records = async () => (await h.db.prepare("SELECT COUNT(*) AS n FROM l_records WHERE kind <> 'audit'").first()).n

  const [supervisor, estimator] = [await imported('Site supervisor'), await imported('Estimator')]
  const live = await liveJob('Site supervisor (live)')
  const stages = { Interview: stageId(live, 'Interview'), Applied: stageId(live, 'Applied') }
  const mapping = { importedJob: supervisor.id, target: live.id, stages, approval: 'adopt', contactBasis: 'none', sourceUrl: 'https://apply.workable.com/example-builders/j/AB12CD/' }

  // The preview names the mapping, what moves and what stays history, and writes nothing; only the owner may ask.
  const before = await records()
  const shown = (await cmd('cutover-preview', mapping)).counts
  assert.deepEqual([shown.moving, shown.setAside, shown.closedHistory, shown.nothingSent], [2, 0, 1, true])
  assert.equal(await records(), before, 'a preview writes nothing')
  await cmd('cutover-preview', mapping, morgan, 403)
  const full = await cmd('cutover-preview', mapping)
  assert.deepEqual(full.moving.map(m => [m.name, m.sourceStage]).sort(), [['Dana Whitfield', 'Interview'], ['Lee Moreno', 'Applied']])
  // Refusals: an unmapped stage, a stale fingerprint, a source that never approved, a bare job or one the owner has not completed.
  const unmapped = await send('/api/lodge/command/cutover', { ...mapping, stages: { Interview: stages.Interview }, fingerprint: full.fingerprint }, owner)
  assert.equal(unmapped.status, 400); assert.match(unmapped.value.error, /Map every source stage first: Applied/)
  assert.equal((await send('/api/lodge/command/cutover', { ...mapping, fingerprint: 'stale' }, owner)).status, 409)
  assert.equal((await send('/api/lodge/command/cutover', { ...mapping, importedJob: live.id, fingerprint: full.fingerprint }, owner)).status, 409, 'only an imported job can be moved')
  assert.equal(await records(), before, 'refusals write nothing')

  // The activation: open applications become live applications with their source stage in the history; imported rows are untouched.
  const done = await cmd('cutover', { ...mapping, fingerprint: full.fingerprint })
  assert.equal(done.moved.length, 2)
  let s = await state()
  const dana = s.candidates.find(c => c.name === 'Dana Whitfield')
  const moved = s.applications.find(a => a.candidate === dana.id && a.vacancy === live.id)
  assert.deepEqual([moved.status, moved.stage, moved.activated.sourceStage, moved.rubricVersion], ['active', stages.Interview, 'Interview', 1])
  assert.equal(s.applications.find(a => a.candidate === dana.id && a.vacancy === supervisor.id).status, 'imported', 'the imported application stays history')
  assert.ok(!s.applications.some(a => a.vacancy === live.id && s.candidates.find(c => c.id === a.candidate)?.name === 'Sam Okafor'), 'a closed application stays history')
  assert.match(s.applications.find(a => a.id === moved.id).history.at(-1).reason, /Moved live from Workable at “Interview” \(cutover\)/)
  assert.equal((await cmd('cutover-preview', mapping)).counts.setAside, 2, 'the same people are not moved twice')
  assert.equal(s.vacancies.find(v => v.id === live.id).approvedNow, true, 'adopting the source approval approves the live job’s exact terms')
  assert.match(s.audit.find(e => e.action === 'approval-adopted').sourceApproval, /approved/)
  assert.equal((await send('/api/lodge/command/vacancy', { ...live, headcount: 4, manager: 'morgan@example.test' }, owner)).status, 200)
  assert.equal((await state()).vacancies.find(v => v.id === live.id).approvedNow, false, 'a later change to the terms makes the adopted approval stale')
  await cmd('vacancy', { ...live, headcount: 3, manager: 'morgan@example.test' })
  await cmd('publish', { id: live.id })

  // The old job link now works: it redirects to the live job once published.
  assert.equal((await send('/jobs/legacy/workable/7001')).status, 302)

  // Nobody is contactable until the employer records a basis; then a draft is allowed.
  const refused = await send('/api/lodge/command/message', { application: moved.id, purpose: 'other', subject: 'Hello', body: 'Hello' }, owner)
  assert.equal(refused.status, 409); assert.match(refused.value.error, /Record a basis for contacting people moved in/)
  await cmd('contact-basis', { application: moved.id, note: 'Applied through the old careers page' }, owner, 400)
  await cmd('contact-basis', { application: moved.id, attest: true, note: 'Applied through the old careers page; counsel confirmed we may continue' })
  await cmd('message', { application: moved.id, purpose: 'other', subject: 'Hello', body: 'Hello' })

  // Ordinary work continues on the live application, its files and the comments imported with it.
  const forMorgan = await state(morgan)
  assert.ok(forMorgan.applications.some(a => a.id === moved.id), 'the job’s manager sees the live application')
  const resume = forMorgan.documents.find(d => d.name === 'dana-resume.txt')
  assert.ok(resume, 'the imported resume follows the application to its live job')
  assert.equal((await send('/api/lodge/download/document/' + resume.id, undefined, morgan)).text, await readFile(`${FIXTURE}/7001/5001-dana-whitfield/dana-resume.txt`, 'utf8'))
  assert.equal(forMorgan.importedHistory.notes.find(n => n.body.startsWith('Strong references')).application, moved.id)
  await cmd('move', { application: moved.id, to: stageId(live, 'Decision'), reason: 'Strong site walk' }, morgan)
  assert.equal((await state()).applications.find(a => a.id === moved.id).history.at(-1).reason, 'Strong site walk')

  // A second job needs its own approval: it will not publish, while its applicants still move.
  const fresh = await liveJob('Estimator (live)')
  const second = { importedJob: estimator.id, target: fresh.id, stages: { 'Phone screen': stageId(fresh, 'Screen'), Applied: stageId(fresh, 'Applied') }, approval: 'fresh', contactBasis: 'none' }
  const plan2 = await cmd('cutover-preview', second)
  assert.deepEqual(plan2.moving.map(m => m.name).sort(), ['Kai Ito', 'Lee Moreno'])
  await cmd('cutover', { ...second, fingerprint: plan2.fingerprint })
  assert.equal((await send('/api/lodge/command/publish', { id: fresh.id }, owner)).status, 409, 'the job refuses publishing until LDG-001 approval')
  const kai = (await state()).applications.find(a => a.vacancy === fresh.id && a.stage === stageId(fresh, 'Applied'))
  await cmd('move', { application: kai.id, to: stageId(fresh, 'Interview'), reason: 'Phone screen passed' }, owner)
  assert.equal((await state()).applications.find(a => a.id === kai.id).stage, stageId(fresh, 'Interview'), 'applicants still move')

  // Undo removes only what nobody touched; the moved person stays live with the reason.
  const undone = await cmd('cutover-undo', { id: done.id })
  assert.equal(undone.status, 'undone')
  assert.deepEqual([undone.undone.removed.length, undone.undone.kept.length], [1, 1])
  s = await state()
  assert.ok(!s.applications.some(a => a.vacancy === live.id && a.candidate === s.candidates.find(c => c.name === 'Lee Moreno').id), 'the untouched live application is removed')
  const kept = s.applications.find(a => a.id === moved.id)
  assert.deepEqual([kept.status, kept.stage, typeof kept.activated.retained.reason], ['active', stageId(live, 'Decision'), 'string'])
  assert.equal((await send('/jobs/legacy/workable/7001')).status, 302, 'the legacy link stays while a moved person is live')
  assert.equal((await send('/api/lodge/command/cutover-undo', { id: done.id }, owner)).status, 409)
 } finally { await h.close() }
}

// MIG-008 on the real screen at 1440 and 390: after the Workable kit's import (made through its own screen), the owner prepares a live job, previews the
// mapped cutover on the Move in screen, approves that exact preview and sees the moved people on the live job.




async function fits(page, label) {
 const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }))
 assert.ok(scroll <= width + 1, `${label}: no sideways scrolling (${scroll} > ${width})`)
}

export async function cutoverPage(browser, { root, origin, run, evidence }) {
 for (const [width, imported, people] of [[1440, 'Site supervisor', ['Dana Whitfield', 'Lee Moreno']], [390, 'Estimator', ['Kai Ito', 'Lee Moreno']]].filter(([width]) => browserWidths.includes(width))) {
  const title = `${imported} (live ${width})`
  const job = await run('vacancy', { title, location: 'Brooklyn, NY', headcount: 2, manager: 'manager@dev.localhost', compensation: { currency: 'USD', min: 6500000, max: 8500000, period: 'year' } })
  await run('rubric', { id: job.id, criteria: [{ name: 'Safety', description: 'Explains safe site operations' }] })
  await run('interview-plan', { id: job.id, plan: [{ name: 'Walk', stageName: 'Interview', durationMinutes: 30 }] })
  const s = await session(browser, root, origin, 'owner', width)
  try {
   const errors = []; s.page.on('pageerror', e => errors.push(e.message))
   const page = s.page
   await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Move in', exact: true }).click()
   const card = page.getByRole('region', { name: 'Cutover' })
   await card.getByLabel('Imported job').selectOption({ label: imported })
   await card.getByLabel('Live job').selectOption({ label: `${title} (draft)` })
   const stageLabels = await card.getByText(/^Source stage “/).allTextContents()
   assert.ok(stageLabels.length >= 2, 'one mapping per source stage')
   for (const label of stageLabels) {
    const name = label.match(/“(.+)”/)[1]
    await card.getByLabel(label).selectOption({ label: name === 'Phone screen' ? 'Screen' : name === 'Interview' ? 'Interview' : 'Applied' })
   }
   await card.getByRole('button', { name: 'Preview cutover' }).click()
   const preview = page.getByRole('region', { name: 'Cutover preview' })
   await preview.getByText(/2 to move/).waitFor()
   for (const name of people) await preview.getByText(name).waitFor()
   await fits(page, 'cutover preview')
   await page.screenshot({ path: join(evidence, `MIG-008-preview-${width}.png`), fullPage: true })
   await preview.getByRole('button', { name: 'Approve this cutover' }).click()
   await card.getByText(/undone|live/).first().waitFor()
   const w = await current(s.context, origin)
   const live = w.applications.filter(a => a.vacancy === job.id)
   assert.equal(live.length, 2); assert.ok(live.every(a => a.status === 'active' && a.activated))
   assert.deepEqual(live.map(a => a.candidateName).sort(), [...people].sort())
   await fits(page, 'cutover done')
   await page.screenshot({ path: join(evidence, `MIG-008-done-${width}.png`), fullPage: true })
   assert.deepEqual(errors, [])
  } finally { await s.context.close() }
 }
}
