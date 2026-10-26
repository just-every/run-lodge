import assert from 'node:assert/strict'

/** Check only visible icon controls on the clause's current screen. */
export async function iconTooltips(page, screenshot) {
 const controls = page.locator('button,a')
 const indices = await controls.evaluateAll(nodes => nodes.flatMap((node, index) => node.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && !node.innerText.trim() ? [index] : []))
 let captured = false
 for (const index of indices) {
  const control = controls.nth(index), described = (await control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  const id = await page.evaluate(ids => ids.find(id => document.getElementById(id)?.getAttribute('role') === 'tooltip'), described)
  const label = await control.getAttribute('aria-label') ?? await control.getAttribute('class') ?? await control.evaluate(node => node.tagName)
  assert.ok(id, 'every visible icon control has a tooltip: ' + label)
  const tooltip = page.locator('[id=' + JSON.stringify(id) + ']')
  const words = (await tooltip.textContent()).trim().split(/\s+/)
  assert.ok(words.length >= 2 && words.length <= 4, 'icon tooltips use a few words')
  await control.focus()
  assert.ok(await tooltip.isVisible(), 'tooltip appears on keyboard focus')
  if (!captured && screenshot) { await page.screenshot({ path: screenshot, fullPage: true }); captured = true }
  await control.evaluate(node => node.blur())
  await page.mouse.move(0, 0); await page.waitForTimeout(350)
  await control.hover(); await page.waitForTimeout(350)
  assert.ok(await tooltip.isVisible(), 'tooltip appears after the hover delay')
 }
 return indices.length
}
