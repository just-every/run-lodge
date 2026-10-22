import { furtherLanguagePage } from './further-language-page.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { current, session } from './browser-journey.mjs'
import { languageJob, spanishText } from './languages-flow.mjs'

export async function languagesPage(browser, { root, origin, run, evidence, ownerEmail }) {
  const approve = async r => { const owner = await session(browser, root, origin, 'owner', 1440); try { const version = (await current(owner.context, origin)).approvals.find(a => a.id === r.id).currentVersion; await run('decide-approval', { id: r.id, decision: 'approved', reason: 'Budgeted', version }) } finally { await owner.context.close() } }
  const { job, q, es } = await languageJob(run, approve, ownerEmail)
  for (const width of [1440, 390]) {
    const owner = await session(browser, root, origin, 'owner', width)
    try {
      const page = owner.page
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await page.getByRole('button', { name: 'Open Warehouse Associate', exact: true }).click()
      const posts = page.getByRole('region', { name: 'Job posts' })
      await posts.getByText('Change post “Asociado de almacén”', { exact: true }).click()
      await posts.getByText('Spanish translation for “Asociado de almacén”', { exact: true }).click()
      const tr = spanishText(q)
      await posts.getByLabel('Spanish privacy notice', { exact: false }).fill(tr.notice)
      await posts.getByLabel('Spanish accommodation text', { exact: false }).fill(tr.accommodation)
      await posts.getByLabel('Spanish voluntary gender question', { exact: false }).fill(tr.monitoring)
      for (const [i, o] of ['Prefer not to say', 'Woman', 'Man', 'Non-binary', 'Another description'].entries()) await posts.getByLabel('Spanish: ' + o, { exact: true }).fill(tr.monitoringOptions[i])
      await posts.getByLabel('Spanish question: Can you work at night?', { exact: true }).fill(tr.questions[q.id].text)
      await posts.getByLabel('Spanish help: The shift begins at eight.', { exact: true }).fill(tr.questions[q.id].help)
      for (const [i, o] of ['Weekdays', 'Weekends'].entries()) await posts.getByLabel('Spanish choice: ' + o, { exact: true }).fill(tr.questions[q.id].options[i])
      await posts.getByLabel('The employer has reviewed these translations', { exact: false }).check()
      await posts.getByRole('button', { name: 'Save reviewed translation', exact: true }).click()
      await page.getByText('Saved.', { exact: true }).waitFor()
      if (width === 1440) await posts.getByRole('button', { name: 'Go live', exact: true }).click()
      await page.screenshot({ path: join(evidence, `ATTR-007-translations-${width}.png`), fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    } finally { await owner.context.close() }
    const visitor = await browser.newContext({ viewport: { width, height: 1000 }, javaScriptEnabled: false, locale: 'es-ES' })
    try {
      const page = await visitor.newPage()
      await page.goto(origin + '/jobs')
      await page.getByRole('link', { name: 'Asociado de almacén', exact: true }).click()
      assert.equal(await page.locator('html').getAttribute('lang'), 'es')
      // Role/name queries exercise the accessible tree used by a screen reader, with scripts disabled.
      await page.getByRole('textbox', { name: 'Nombre completo', exact: true }).fill('Lucía Torres ' + width)
      await page.getByRole('textbox', { name: 'Correo electrónico', exact: true }).fill(`lucia${width}@example.test`)
      await page.getByLabel('¿Puede trabajar por la noche?', { exact: false }).selectOption('Weekdays')
      await page.getByLabel('He leído el aviso de privacidad', { exact: false }).check()
      await page.screenshot({ path: join(evidence, `ATTR-007-application-${width}.png`), fullPage: true })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click()
      await page.getByRole('heading', { name: 'Solicitud recibida', exact: true }).waitFor()
      assert.match(await page.textContent('main'), /LDG-[0-9A-F]{8}/)
      await page.screenshot({ path: join(evidence, `ATTR-007-receipt-${width}.png`), fullPage: true })
      const code = await page.locator('[data-recovery-code]').textContent()
      await page.getByRole('link', { name: 'Recuperar un comprobante', exact: true }).click()
      await page.getByRole('textbox', { name: 'Código privado de recuperación', exact: true }).fill(code)
      await page.getByRole('button', { name: 'Recuperar comprobante', exact: true }).click()
      await page.getByRole('heading', { name: 'Solicitud recibida', exact: true }).waitFor()
      await page.screenshot({ path: join(evidence, `ATTR-007-recovered-${width}.png`), fullPage: true })
    } finally { await visitor.close() }
    const reviewer = await session(browser, root, origin, 'owner', width)
    try {
      const w = await current(reviewer.context, origin), app = w.applications.find(a => a.candidateName === 'Lucía Torres ' + width)
      await reviewer.page.goto(origin + '/app?application=' + app.id)
      const panel = reviewer.page.getByRole('tabpanel', { name: 'Overview', exact: true })
      await panel.getByText('Screening answers', { exact: true }).waitFor()
      await panel.getByText('¿Puede trabajar por la noche?', { exact: false }).waitFor()
      await panel.getByText('Source: Can you work at night?', { exact: true }).waitFor()
      await reviewer.page.screenshot({ path: join(evidence, `ATTR-007-review-${width}.png`), fullPage: true })
    } finally { await reviewer.context.close() }
  }
  await run('post-status', { vacancy: job.id, post: es.id, status: 'paused' })
  await run('post-translation', { vacancy: job.id, post: es.id, translation: { ...spanishText(q), questions: {} } })
  const owner = await session(browser, root, origin, 'owner', 390)
  try {
    const response = await owner.context.request.post(origin + '/api/lodge/command/post-status', { headers: { origin }, data: { vacancy: job.id, post: es.id, status: 'live' } })
    assert.equal(response.status(), 409, 'a missing Spanish question refuses publishing')
  } finally { await owner.context.close() }
  await furtherLanguagePage(browser, { root, origin, run, evidence, job, q })
}
