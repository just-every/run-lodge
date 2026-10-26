// Hosted Okta sign-in and temporary-user authenticators.
import { createHmac } from 'node:crypto'
import { LiveFailure, check, okta, resources, report } from './enterprise-live-provider.mjs'

function totp(factor) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bytes = []
  let bits = 0, value = 0
  for (const char of factor.sharedSecret.toUpperCase().replace(/=+$/, '')) {
    const digit = alphabet.indexOf(char); check(digit >= 0, 'invalid temporary TOTP enrollment secret')
    value = (value << 5) | digit; bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255) }
  }
  const counter = Math.floor(Date.now() / 1000 / factor.timeStep), input = Buffer.alloc(8)
  input.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(input).digest(), offset = digest.at(-1) & 15
  return { counter, code: String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** factor.keyLength)).padStart(factor.keyLength, '0') }
}

// User Factors API, scoped exclusively to a user created by this run. Catalog
// availability respects existing enrollment policy; no org settings change.
// https://developer.okta.com/docs/api/openapi/okta-management/management/tag/UserFactor/
async function enrollTotp(config, person) {
  check(resources.users.includes(person.id), 'factor enrollment needs a temporary user')
  const path = `/api/v1/users/${encodeURIComponent(person.id)}/factors`
  const catalog = await okta(config, path + '/catalog')
  check(Array.isArray(catalog), 'temporary-user factor catalog unavailable')
  if (!catalog.some(f => f.factorType === 'token:software:totp' && f.provider === 'GOOGLE')) return null
  const factor = await okta(config, path, { method: 'POST', body: { factorType: 'token:software:totp', provider: 'GOOGLE' } })
  const activation = factor._embedded?.activation
  check(factor.id && activation?.sharedSecret && activation.encoding === 'base32', 'temporary TOTP factor activation unavailable')
  const settings = { ...activation, timeStep: Number(activation.timeStep ?? 30), keyLength: Number(activation.keyLength ?? 6) }
  check(settings.timeStep > 0 && settings.keyLength >= 6 && settings.keyLength <= 8, 'unsupported temporary TOTP parameters')
  const passcode = totp(settings)
  const active = await okta(config, path + `/${encodeURIComponent(factor.id)}/lifecycle/activate`, { method: 'POST', body: { passCode: passcode.code } })
  check(active.status === 'ACTIVE', 'temporary TOTP factor not activated')
  report('temporary user enrolled a policy-supported TOTP factor')
  return { ...settings, usedCounter: passcode.counter }
}

async function visible(locator) {
  for (const item of await locator.all()) if (await item.isVisible()) return item
  return null
}

async function submitProvider(page) {
  const submit = await visible(page.locator('input[type="submit"], button[type="submit"]'))
  check(submit && await submit.isEnabled(), 'hosted Okta form submit unavailable')
  await submit.click()
}

function requiredDependency(text) {
  if (/redirect_uri|redirect uri/i.test(text)) return 'provider rejected the registered callback URI'
  if (/not assigned|not been assigned/i.test(text)) return 'provider application assignment unavailable'
  if (/invalid client|client_id|client id/i.test(text)) return 'provider rejected the isolated application client'
  if (/bad request|invalid_request/i.test(text)) return 'provider rejected the authorization request'
  if (/check your email|enter.*email.*code|verify with email/i.test(text)) return 'temporary-user email inbox required by provider policy'
  if (/okta verify|fastpass|push notification/i.test(text)) return 'provider policy requires an unavailable Okta Verify enrollment or device'
  if (/phone|sms|text message/i.test(text)) return 'provider policy requires a temporary-user telephony factor'
  if (/access denied|not allowed|unable to sign in/i.test(text)) return 'provider sign-in policy refused the temporary user'
  if (/security key|biometric|passkey/i.test(text)) return 'provider WebAuthn enrollment or verification did not finish in the isolated virtual authenticator'
  return 'hosted Okta step needs a supported temporary-user authenticator'
}

async function signIn(browser, h, config, person, { button = 'Continue with employer Okta', callback = '/auth/oidc/lodge-okta/callback' } = {}) {
  const factor = await enrollTotp(config, person)
  const context = await browser.newContext(), page = await context.newPage()
  let callbackStatus, usernameSent = false, passwordSent = false, otpSent = false, factorSelected = false, keySetup = false, alternativesShown = false
  try {
    page.setDefaultTimeout(10000)
    // The test Worker has no Cloudflare edge to supply its client address.
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': '127.0.0.1' })
    page.on('response', response => {
      const url = new URL(response.url())
      if (url.origin === h.origin && url.pathname === callback) callbackStatus = response.status()
      if (url.origin === config.origin && response.status() >= 400 && response.request().isNavigationRequest()) report(`hosted Okta navigation refused with HTTP ${response.status()}`)
    })
    // This authenticator is virtual, owned by this fresh test context, and
    // never presented as proof of real hardware or device-bound assurance.
    // https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    // Offer both documented attachment kinds; provider policy selects the kind.
    for (const transport of ['internal', 'usb']) await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport, hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
    cdp.on('WebAuthn.credentialAdded', () => report('temporary user enrolled a CDP virtual WebAuthn credential; hardware assurance is not proven'))
    cdp.on('WebAuthn.credentialAsserted', () => report('temporary user completed a CDP virtual WebAuthn assertion'))
    await page.goto(h.origin + '/enterprise/signin')
    const [started] = await Promise.all([
      page.waitForResponse(response => response.url() === h.origin + callback.replace(/callback$/, 'start')),
      page.getByRole('button', { name: button, exact: true }).click(),
    ])
    if (started.status() !== 303) {
      const result = await started.json().catch(() => ({}))
      throw new LiveFailure(`native identity start HTTP ${started.status()}${/^oidc_[a-z_]+$/.test(result.error) ? ': ' + result.error : ''}`)
    }
    const deadline = Date.now() + 150000
    while (Date.now() < deadline && callbackStatus === undefined) {
      const current = new URL(page.url())
      check([h.origin, config.origin].includes(current.origin), 'hosted sign-in left the configured origins')
      const nativeNotice = current.origin === h.origin && current.searchParams.get('notice')
      if (/^oidc_[a-z_]+$/.test(nativeNotice)) throw new LiveFailure(`native identity notice: ${nativeNotice}`)
      const oauthError = current.searchParams.get('error')
      if (['login_required', 'access_denied', 'invalid_request', 'invalid_scope', 'unauthorized_client', 'interaction_required'].includes(oauthError)) throw new LiveFailure(`provider authorization error: ${oauthError}`)
      if (current.origin !== config.origin) { await page.waitForTimeout(250); continue }
      const username = await visible(page.locator('input[name="identifier"], input[name="username"], input[autocomplete="username"]'))
      const password = await visible(page.locator('input[type="password"]'))
      if (username && !usernameSent) {
        await username.fill(person.login); usernameSent = true
        if (password) { await password.fill(person.password); passwordSent = true }
        report('hosted Okta temporary-user identifier submitted'); await submitProvider(page)
      } else if (password && !passwordSent) {
        await password.fill(person.password); passwordSent = true
        report('hosted Okta temporary-user password submitted'); await submitProvider(page)
      } else {
        const otp = await visible(page.locator('input[autocomplete="one-time-code"], input[name="credentials.passcode"]:not([type="password"]), input[name="answer"], input[name="passCode"]'))
        const rows = page.locator('.authenticator-row, [data-se="authenticator-enroll-list"] > div, [data-se="authenticator-verify-list"] > div')
        const google = factor && await visible(rows.filter({ hasText: /Google Authenticator/i }).locator('button, a').filter({ hasText: /^(select|set up|verify)$/i }))
        const key = await visible(rows.filter({ hasText: /security key|biometric|passkey/i }).locator('button, a').filter({ hasText: /^(select|set up|verify)$/i }))
        const alternatives = !alternativesShown && await visible(page.getByRole('link', { name: /verify with something else|select another authenticator|choose another security method/i }))
        const totpChallenge = otp && /Google Authenticator/i.test(await page.locator('body').innerText())
        if (otp && factor && totpChallenge && !otpSent) {
          // Activation codes cannot be replayed as an authentication challenge.
          while (totp(factor).counter === factor.usedCounter) await page.waitForTimeout(500)
          const passcode = totp(factor); factor.usedCounter = passcode.counter
          await otp.fill(passcode.code); otpSent = true
          report('hosted Okta temporary-user TOTP challenge submitted'); await submitProvider(page)
        } else if (!factorSelected && (google || key)) {
          await (google || key).click(); factorSelected = true
          report(google ? 'hosted Okta TOTP factor selected' : 'hosted Okta virtual WebAuthn factor selected')
        } else if (alternatives) {
          await alternatives.click(); alternativesShown = true
          report('hosted Okta available authentication methods opened')
        } else if (factorSelected && !keySetup && !google) {
          // OIE generation 2 uses a separate setup anchor; generation 3 a button.
          const setup = await visible(page.locator('.webauthn-setup').or(page.getByRole('button', { name: /^(Set up|Enroll|Verify|Continue)$/i })))
          if (setup && !otp) { await setup.click(); keySetup = true; report('hosted Okta virtual WebAuthn ceremony continued') }
        }
      }
      await page.waitForTimeout(400)
    }
    check(callbackStatus !== undefined, requiredDependency(await page.locator('body').innerText()))
    check(callbackStatus === 303, 'browser identity callback refused')
    const cookie = (await context.cookies(h.origin)).map(c => `${c.name}=${c.value}`).join('; ')
    const current = await h.send('/auth/session', undefined, cookie)
    check(current.status === 200 && current.value.kind === 'oidc' && current.value.operator.email === person.login, 'native browser enterprise session absent')
    check((await h.send('/api/lodge/state', undefined, cookie)).status === 200, 'native browser session cannot enter Lodge')
    return cookie
  } finally { await context.close() }
}

export { signIn }
