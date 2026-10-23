import { browserWidths } from './browser-widths.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { careersJob } from './careers-driver.mjs'
import { current, session } from './browser-journey.mjs'

// ATTR-014: a job with yes/no, single-choice and multiple-choice questions and a required attachment; the device-local draft keeps the choices and the files,
// never consent or the private answers, and is refused and removed once the employer changes the form through the job's own editor.
const questionInputs = [
  { text: 'Can you work weekends?', type: 'yes-no', required: true },
  { text: 'Preferred shift', type: 'single-choice', options: ['Day shift', 'Night shift'], required: true },
  { text: 'Tools you use', type: 'multiple-choice', options: ['Hoist', 'Scaffold', 'Laser level'], required: false },
  { text: 'Safety certificate', type: 'file', required: true },
]
const certificate = width => Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, width & 255, 10, 13, 0, 128, 129])

async function shot(page, evidence, name, width) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
  await page.screenshot({ path: join(evidence, `careers-draft-${name}-${width}.png`), fullPage: true })
}
const stored = page => page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('lodge-application-draft:'))?.[1] ?? null)
const press = async (page, name) => { const button = page.getByRole('button', { name, exact: true }); await button.focus(); await page.keyboard.press('Enter') }

export async function careersDraftPage(browser, { root, origin, run, evidence }) {
  const library = []
  for (const input of questionInputs) library.push(await run('question', input))
  const job = await careersJob(run, 'Draft trial supervisor')
  const attach = questions => run('job-questions', { id: job.id, questions: questions.map(q => ({ question: q.id, required: q.id !== library[2].id })) })
  for (const width of browserWidths) {
    await attach(library)
    const owner = await session(browser, root, origin, 'owner', width)
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const page = await context.newPage()
      const open = async () => {
        await page.goto(origin + '/jobs/' + job.slug)
        return {
          name: page.getByRole('textbox', { name: 'Full name', exact: true }),
          weekends: page.getByRole('group', { name: /Can you work weekends/ }),
          shift: page.getByRole('combobox', { name: /Preferred shift/ }),
          tools: page.getByRole('group', { name: /Tools you use/ }),
          consent: page.getByRole('checkbox', { name: /I have read privacy notice/ }),
          pool: page.getByRole('checkbox', { name: /You may contact me about other suitable roles/ }),
          adjustments: page.getByRole('textbox', { name: /Adjustments you need/ }),
          monitoring: page.getByRole('combobox', { name: 'Answer', exact: true }),
          resume: page.getByLabel('Resume (optional, PDF, Word or text, up to 1 MB)', { exact: true }),
          certificate: page.getByLabel(/Safety certificate/),
          status: page.locator('[data-draft-status]'),
        }
      }
      const answer = async f => {
        await f.name.fill('Casey Draft ' + width)
        await page.getByRole('textbox', { name: 'Email', exact: true }).fill(`casey-draft-${width}@example.test`)
        await f.resume.setInputFiles({ name: `casey-${width}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Casey Draft: ran safe hoisting on occupied sites.') })
        await f.weekends.getByRole('radio', { name: 'Yes', exact: true }).check()
        await f.shift.selectOption('Night shift')
        if (await f.tools.count()) { await f.tools.getByRole('checkbox', { name: 'Hoist' }).check(); await f.tools.getByRole('checkbox', { name: 'Laser level' }).check() }
        await f.certificate.setInputFiles({ name: `certificate-${width}.bin`, mimeType: 'application/octet-stream', buffer: certificate(width) })
        await f.consent.check(); await f.pool.check()
        await f.adjustments.fill('A private adjustment that stays out of the browser draft.')
        await f.monitoring.selectOption({ index: 1 })
      }
      let f = await open()
      await answer(f)
      await press(page, 'Save draft on this device')
      await f.status.getByText('Draft saved on this device.', { exact: false }).waitFor()
      const draft = JSON.parse(await stored(page))
      const kept = JSON.stringify(draft)
      assert.ok(kept.includes('Casey Draft') && kept.includes('Night shift') && kept.includes('Hoist'), 'typed and chosen answers are kept')
      assert.ok(!kept.includes('private adjustment'), 'accommodation is not kept')
      for (const name of ['consent', 'talentPool', 'accommodation', 'monitoring']) assert.ok(!draft.values.some(([n]) => n === name), name + ' is never kept')
      await shot(page, evidence, 'saved', width)

      // Reload, then resume from the keyboard: choices and files come back; consent and the private answers do not.
      f = await open()
      assert.equal(await f.weekends.getByRole('radio', { name: 'Yes', exact: true }).isChecked(), false)
      await press(page, 'Resume saved draft')
      await f.status.getByText('Draft restored', { exact: false }).waitFor()
      assert.equal(await f.name.inputValue(), 'Casey Draft ' + width)
      assert.equal(await f.weekends.getByRole('radio', { name: 'Yes', exact: true }).isChecked(), true)
      assert.equal(await f.weekends.getByRole('radio', { name: 'No', exact: true }).isChecked(), false)
      assert.equal(await f.shift.inputValue(), 'Night shift')
      assert.deepEqual(await f.tools.getByRole('checkbox').evaluateAll(boxes => boxes.map(b => [b.labels[0].textContent.trim(), b.checked])), [['Hoist', true], ['Scaffold', false], ['Laser level', true]])
      assert.deepEqual(await f.certificate.evaluate(async e => [...e.files].map(file => file.name)), [`certificate-${width}.bin`])
      assert.deepEqual(await f.resume.evaluate(e => [...e.files].map(file => file.name)), [`casey-${width}.txt`])
      assert.equal(await f.consent.isChecked(), false); assert.equal(await f.pool.isChecked(), false)
      assert.equal(await f.adjustments.inputValue(), ''); assert.equal(await f.monitoring.evaluate(e => e.selectedIndex), 0)
      await shot(page, evidence, 'resumed', width)
      await f.consent.check()
      await page.getByRole('button', { name: 'Submit application', exact: true }).click()
      await page.getByRole('heading', { name: 'Application received', exact: true }).waitFor()
      const receipt = /LDG-[A-F0-9]{8}/.exec(await page.textContent('main'))[0]
      const state = await current(owner.context, origin)
      const app = state.applications.find(a => state.receipts.some(r => r.id === receipt && r.application === a.id))
      const bytes = async name => Buffer.from(await (await owner.context.request.get(origin + '/api/lodge/download/document/' + state.documents.find(d => d.application === app.id && d.name === name).id)).body())
      assert.ok((await bytes(`certificate-${width}.bin`)).equals(certificate(width)), 'the recruiter downloads the restored attachment byte for byte')
      assert.equal((await bytes(`casey-${width}.txt`)).toString(), 'Casey Draft: ran safe hoisting on occupied sites.')
      const answered = state.applications.find(a => a.id === app.id).answers
      assert.deepEqual(answered.find(x => x.text === 'Tools you use').value, ['Hoist', 'Laser level'])
      assert.equal(answered.find(x => x.text === 'Can you work weekends?').value, 'yes')

      // A restored attachment is checked again at submission: a draft edited to hold a disallowed type or an oversized file is refused.
      f = await open()
      await answer(f)
      await press(page, 'Save draft on this device')
      await f.status.getByText('Draft saved on this device.', { exact: false }).waitFor()
      for (const [why, message] of [['type', /Resumes may be/], ['size', /at most 1 MB/]]) {
        await page.evaluate(([why, big]) => {
          const key = Object.keys(localStorage).find(k => k.startsWith('lodge-application-draft:')), draft = JSON.parse(localStorage[key])
          for (const [name, saved] of draft.values) {
            if (why === 'type' && name === 'resume') saved.files[0].name = 'casey.exe'
            if (why === 'size' && name.startsWith('q-') && saved.files) saved.files[0].base64 = big
          }
          localStorage[key] = JSON.stringify(draft)
        }, [why, Buffer.alloc(1_100_000, 7).toString('base64')])
        await page.reload()
        await press(page, 'Resume saved draft')
        await f.consent.check()
        await page.getByRole('button', { name: 'Submit application', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: message }).waitFor()
        assert.equal(await page.getByRole('heading', { name: 'Application received' }).count(), 0, 'a restored ' + why + ' problem is refused at submission')
        f = await open(); await answer(f)
        await press(page, 'Save draft on this device')
        await f.status.getByText('Draft saved on this device.', { exact: false }).waitFor()
      }

      // Deleting the draft removes the answers and the files from the device together.
      f = await open()
      await answer(f)
      await press(page, 'Save draft on this device')
      await f.status.getByText('Draft saved on this device.', { exact: false }).waitFor()
      await press(page, 'Delete saved draft')
      await f.status.getByText('Saved draft deleted.', { exact: true }).waitFor()
      assert.deepEqual(await page.evaluate(async () => [Object.keys(localStorage), Object.keys(sessionStorage), (await indexedDB.databases()).map(d => d.name)]), [[], [], []], 'the device keeps neither answers nor files')

      // A real form change through the employer's editor refuses and removes the draft, and tells the applicant.
      const editor = owner.page
      const openJob = async () => {
        await editor.goto(origin + '/app')
        await editor.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
        await editor.getByRole('button', { name: 'Open ' + job.title, exact: true }).click()
        return editor.getByRole('region', { name: 'Screening questions', exact: true })
      }
      const refused = async why => {
        f = await open()
        await f.name.fill('')
        await press(page, 'Resume saved draft')
        await f.status.getByText('No current draft is available', { exact: false }).waitFor()
        assert.equal(await f.name.inputValue(), '', why + ': nothing is restored')
        assert.equal(await stored(page), null, why + ': the refused draft is removed from the device')
      }
      const saveDraft = async () => {
        f = await open(); await answer(f)
        await press(page, 'Save draft on this device')
        await f.status.getByText('Draft saved on this device.', { exact: false }).waitFor()
      }
      // A new version of a question: the employer edits its wording in the library.
      await saveDraft()
      let screening = await openJob()
      await screening.getByText('Question library', { exact: false }).click()
      await screening.getByText('Preferred shift', { exact: false }).last().click()
      const versionForm = screening.locator('details').filter({ has: editor.getByRole('button', { name: 'Save a new version', exact: true }) }).filter({ hasText: 'Preferred shift' }).last()
      await versionForm.getByLabel('Help for applicants').fill('Shift lengths differ by site; edited ' + width)
      await versionForm.getByRole('button', { name: 'Save a new version', exact: true }).click()
      await editor.getByText('Saved.', { exact: true }).waitFor()
      await refused('a new question version')
      // A removed question: the employer stops asking the optional tools question.
      await saveDraft()
      screening = await openJob()
      await screening.getByText('Choose this job’s questions', { exact: true }).click()
      await screening.getByRole('group', { name: 'Tools you use', exact: true }).getByLabel('Ask on this job').uncheck()
      await screening.getByRole('button', { name: 'Save screening questions', exact: true }).click()
      await editor.getByText('Saved.', { exact: true }).waitFor()
      await refused('a removed question')
      // A draft for an unchanged form still resumes.
      await saveDraft()
      f = await open(); await f.name.fill('')
      await press(page, 'Resume saved draft')
      assert.equal(await f.name.inputValue(), 'Casey Draft ' + width)
      await shot(page, evidence, 'unchanged', width)
    } finally { await context.close(); await owner.context.close() }
  }
}
