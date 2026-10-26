import assert from 'node:assert/strict'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { session } from './browser-journey.mjs'

export async function analysisWorkspace(browser, { root, origin, evidence }) {
 for (const width of browserWidths) {
  const owner = await session(browser, root, origin, 'owner', width)
  try {
   await owner.page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'People', exact: true }).click()
   const link = owner.page.getByRole('link', { name: 'Ask a recruiting question and inspect its chart', exact: true })
   await link.waitFor(); await link.scrollIntoViewIfNeeded()
   await iconTooltips(owner.page)
   await owner.page.screenshot({ path: evidence + '/analysis-workspace-' + width + '.png' })
   await link.click()
   await owner.page.getByRole('heading', { name: 'Recruiting analysis', exact: true }).waitFor()
   assert.ok(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
   await owner.page.screenshot({ path: evidence + '/analysis-provider-off-' + width + '.png', fullPage: true })
  } finally { await owner.context.close() }
 }
}
