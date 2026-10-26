import { identityDocument } from './enterprise-browser-idp.mjs'
import { samlFixture } from './enterprise-saml-flow.mjs'
import { bulkInvitationsPage } from './bulk-invitations-browser.mjs'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { browserWidths } from './browser-widths.mjs'
import { iconTooltips } from './icon-tooltips.mjs'
import { enterpriseBindings, enterpriseFixture, enterpriseJob } from './enterprise-flow.mjs'

const cookies = (value, origin) => value.split('; ').map(part => { const at = part.indexOf('='); return { name: part.slice(0, at), value: part.slice(at + 1), url: origin } })
export async function enterprisePage(browser, evidence) {
  await mkdir(evidence, { recursive: true })
  for (const width of browserWidths) {
    const h = await enterpriseFixture(), context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage()
    const shot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits viewport')
      await iconTooltips(page)
      await page.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true })
    }
    try {
      await context.addCookies(cookies(h.owner, h.origin))
      await page.goto(h.origin + '/enterprise/settings')
      await shot('enterprise-disabled')
      await page.getByRole('button', { name: 'Enable employer sign-in', exact: true }).click()
      await page.getByRole('button', { name: 'Disable employer sign-in', exact: true }).waitFor()
      await h.scim('POST', '', { externalId: 'synthetic-lodge-5', userName: 'worker@example.test', displayName: 'Morgan Field', active: true })
      const job = await enterpriseJob(h)
      const form = new FormData()
      for (const [key, value] of Object.entries({ name: 'Consented Applicant', email: 'applicant@example.test', noticeVersion: '1', consent: 'yes', accommodation: 'Step-free access for the site visit', monitoring: 'Woman' })) form.set(key, value)
      assert.equal((await h.send('/jobs/' + job.slug, form)).status, 200)
      const application = (await h.state()).applications.find(a => a.candidateName === 'Consented Applicant')
      await h.command('document', { application: application.id, name: 'Right-to-work-original.txt', kind: 'right-to-work', base64: Buffer.from('Synthetic authorized right-to-work original').toString('base64') })
      const compliance = await h.member('compliance@example.test', ['compliance'], 'Casey Compliance')
      await page.reload()
      await page.getByText(job.title, { exact: true }).click()
      await page.getByLabel('Casey Compliance', { exact: true }).check()
      await shot('enterprise-grants-review')
      await page.getByRole('button', { name: 'Apply compliance grants', exact: true }).click()
      await page.getByRole('heading', { name: 'Enterprise identity', exact: true }).waitFor()
      const state = await h.state()
      assert.deepEqual(state.vacancies.find(v => v.id === job.id).compliancePeople, ['compliance@example.test'])
      await shot('enterprise-enabled')
      await context.clearCookies(); await context.addCookies(cookies(compliance, h.origin))
      await page.goto(h.origin + '/enterprise/compliance')
      await page.getByRole('heading', { name: 'Compliance records', exact: true }).waitFor()
      await page.getByRole('link', { name: 'Right-to-work-original.txt', exact: true }).waitFor()
      await page.getByText('Step-free access for the site visit', { exact: true }).waitFor()
      await shot('enterprise-compliance-scoped')
      await context.clearCookies(); await context.addCookies(cookies(h.owner, h.origin))
      await page.goto(h.origin + '/enterprise/signin')
      await page.getByRole('button', { name: 'Continue with employer Okta', exact: true }).waitFor()
      await shot('enterprise-signin')
      // Fake only the remote IdP document; the form and redirect are native.
      const { reached: identity } = await identityDocument(page, enterpriseBindings.ENTERPRISE_OKTA_ISSUER + '/oauth2/v1/authorize', () => '<h1>Synthetic identity provider</h1>')
      await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': '127.0.0.1' })
      const [started] = await Promise.all([
        page.waitForResponse(response => response.url() === h.origin + '/auth/oidc/lodge-okta/start'),
        page.getByRole('button', { name: 'Continue with employer Okta', exact: true }).click(),
      ])
      const destination = new URL((await started.allHeaders()).location, h.origin)
      assert.equal(destination.searchParams.get('notice'), null, 'native start notice')
      assert.equal(destination.origin, enterpriseBindings.ENTERPRISE_OKTA_ISSUER, 'native start redirects to the pinned provider')
      await identity
      await page.getByRole('heading', { name: 'Synthetic identity provider', exact: true }).waitFor()
      assert.equal(new URL(page.url()).origin, enterpriseBindings.ENTERPRISE_OKTA_ISSUER, 'browser policy permits the pinned employer redirect')
      const signed = await h.login(); assert.equal(signed.status, 303)
      await h.scim('PATCH', '/synthetic-lodge-5', { Operations: [{ op: 'replace', path: 'active', value: false }] })
      await page.goto(h.origin + '/enterprise/settings')
      assert.ok((await page.locator('body').innerText()).includes('Suspended'))
      await shot('enterprise-suspended')
      await context.clearCookies(); await context.addCookies(cookies(signed.cookie, h.origin))
      await page.goto(h.origin + '/enterprise/settings')
      await page.getByRole('alert').waitFor()
      await shot('enterprise-access-revoked')
      assert.equal((await h.send('/api/lodge/state', undefined, compliance)).status, 200)
    } finally { await context.close(); await h.close() }
    const saml = await samlFixture(), samlContext = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      await saml.enable()
      const samlPage = await samlContext.newPage()
      await samlPage.goto(saml.origin + '/enterprise/signin')
      await samlPage.getByRole('button', { name: 'Continue with employer SAML', exact: true }).waitFor()
      assert.equal(await samlPage.getByRole('button', { name: 'Continue with employer Okta', exact: true }).count(), 0)
      assert.ok(await samlPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await iconTooltips(samlPage)
      await samlPage.screenshot({ path: evidence + '/enterprise-saml-signin-' + width + '.png', fullPage: true })
      assert.equal((await saml.scim('POST', '', { externalId: 'synthetic-lodge-6', userName: 'worker@example.test', active: true })).status, 201)
      const { reached: samlIdentity } = await identityDocument(samlPage, 'https://synthetic-lodge-3.example.test/sso', url => {
        const requestId = url.searchParams.get('RelayState')
        const assertion = Buffer.from(saml.response({ requestId })).toString('base64')
        return `<form method="post" action="${saml.origin}/enterprise/saml/callback"><input name="RelayState" value="${requestId}"><input name="SAMLResponse" value="${assertion}"><button>Finish synthetic sign-in</button></form>`
      })
      await samlPage.getByRole('button', { name: 'Continue with employer SAML', exact: true }).click()
      await samlIdentity
      await samlPage.getByRole('button', { name: 'Finish synthetic sign-in', exact: true }).click()
      await samlPage.waitForURL(saml.origin + '/app')
      const admitted = await samlContext.request.get(saml.origin + '/auth/session')
      assert.equal(admitted.status(), 200, 'SAML browser correlation cookie survives the cross-site form post')
      assert.equal((await admitted.json()).operator.email, 'worker@example.test')
    } finally { await samlContext.close(); await saml.close() }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true, ...(process.env.LODGE_CHROMIUM ? { executablePath: process.env.LODGE_CHROMIUM } : {}), args: ['--use-mock-keychain', '--password-store=basic'] })
  try { const evidence = process.env.LODGE_EVIDENCE ?? '.cache/enterprise-proof'; await enterprisePage(browser, evidence); await bulkInvitationsPage(browser, evidence) } finally { await browser.close() }
  console.log('enterprise browser passed')
}
