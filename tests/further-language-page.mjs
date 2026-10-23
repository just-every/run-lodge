import { browserWidths } from './browser-widths.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { session } from './browser-journey.mjs'
import { FRENCH } from './language-fixtures.mjs'

export const frenchText = q => ({ reviewed: true, notice: 'Nous utilisons votre candidature pour ce poste et la conservons un an.', accommodation: 'Pour demander un aménagement, contactez le service de recrutement ou décrivez-le ci-dessous. Seuls les administrateurs le consultent.', monitoring: 'Comment décrivez-vous votre genre ?', monitoringOptions: ['Je préfère ne pas répondre', 'Femme', 'Homme', 'Non binaire', 'Autre description'], questions: { [q.id]: { text: 'Pouvez-vous travailler la nuit ?', help: 'Le service commence à huit heures.', options: ['En semaine', 'Le week-end'] } }, fields: {}, ui: FRENCH })

export async function furtherLanguagePage(browser, { root, origin, run, evidence, job, q }) {
  let v = await run('job-post', { vacancy: job.id, title: 'Agent d’entrepôt', description: 'Chargez les marchandises en toute sécurité.', language: 'fr', locations: [job.officeId], destinations: ['careers', 'embed', 'api'] })
  const post = v.posts.at(-1)
  await run('post-translation', { vacancy: job.id, post: post.id, translation: { ...frenchText(q), reviewed: false } })
  for (const width of browserWidths) {
    const owner = await session(browser, root, origin, 'owner', width)
    try {
      const page = owner.page
      await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Vacancies', exact: true }).click()
      await page.getByRole('button', { name: 'Open Warehouse Associate', exact: true }).click()
      const posts = page.getByRole('region', { name: 'Job posts', exact: true })
      await posts.getByText('Change post “Agent d’entrepôt”', { exact: true }).click()
      const summary = posts.getByText('French translation for “Agent d’entrepôt”', { exact: true })
      await summary.click()
      const editor = summary.locator('..')
      await posts.getByText('Application, receipt and candidate email text', { exact: true }).click()
      await editor.locator('textarea[name="ui-name"]').fill(FRENCH.name)
      await editor.getByLabel('The employer has reviewed these translations', { exact: false }).check()
      await editor.getByRole('button', { name: 'Save reviewed translation', exact: true }).click()
      if (width === browserWidths[0]) await posts.getByRole('button', { name: 'Go live', exact: true }).click()
      await posts.getByRole('button', { name: 'Pause post', exact: true }).waitFor()
      await posts.getByText('Application, receipt and candidate email text', { exact: true }).scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: join(evidence, `ATTR-007-further-editor-${width}.png`) })
    } finally { await owner.context.close() }
    const visitor = await browser.newContext({ viewport: { width, height: 1000 }, javaScriptEnabled: false, locale: 'fr-FR' })
    try {
      const page = await visitor.newPage()
      await page.goto(origin + '/jobs/' + post.slug)
      await page.getByRole('textbox', { name: 'Nom complet', exact: true }).fill('Camille Laurent ' + width)
      await page.getByRole('textbox', { name: 'Adresse électronique', exact: true }).fill(`camille${width}@example.test`)
      await page.getByLabel('Pouvez-vous travailler la nuit ?', { exact: false }).selectOption('Weekdays')
      await page.getByLabel('J’ai lu l’avis de confidentialité', { exact: false }).check()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: join(evidence, `ATTR-007-further-application-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Envoyer la candidature', exact: true }).click()
      await page.getByRole('heading', { name: 'Candidature reçue', exact: true }).waitFor()
      assert.equal(await page.locator('html').getAttribute('lang'), 'fr')
      await page.screenshot({ path: join(evidence, `ATTR-007-further-receipt-${width}.png`), fullPage: true })
      const code = await page.locator('[data-recovery-code]').textContent()
      await page.getByRole('link', { name: FRENCH.recoveryLink, exact: true }).click()
      await page.screenshot({ path: join(evidence, `ATTR-007-further-recovery-form-${width}.png`), fullPage: true })
      await page.getByRole('textbox', { name: FRENCH.recoverCode, exact: true }).fill('0'.repeat(64))
      await page.getByRole('button', { name: FRENCH.recoverSubmit, exact: true }).click()
      await page.getByRole('alert').waitFor()
      await page.screenshot({ path: join(evidence, `ATTR-007-further-recovery-refused-${width}.png`), fullPage: true })
      await page.getByRole('textbox', { name: FRENCH.recoverCode, exact: true }).fill(code)
      await page.getByRole('button', { name: FRENCH.recoverSubmit, exact: true }).click()
      await page.getByRole('heading', { name: FRENCH.received, exact: true }).waitFor()
      await page.screenshot({ path: join(evidence, `ATTR-007-further-recovered-${width}.png`), fullPage: true })
    } finally { await visitor.close() }
  }
}
