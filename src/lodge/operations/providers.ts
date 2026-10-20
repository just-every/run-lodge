import type { State } from '../core/state'
import { requireAdmin } from '../core/access'
import { canonical, integer, now, oneOf, requireThat, sha256, text, type Actor, type Data } from '../core/types'

/** Prerequisites, not connections or provider quotes. Checked against official docs 20 Oct 2026. */
export const PROVIDERS = [
  { id: 'twilio', name: 'Twilio SMS', unit: 'SMS segments', plan: 'Paid Twilio account with Programmable Messaging and an SMS-capable sender. US long-code traffic needs approved A2P 10DLC brand and campaign registration.', app: 'Twilio account/API credentials and configured Messaging Service or sender; sender registration appropriate to sender type.', legal: 'Employer-reviewed opt-in evidence, STOP/HELP handling, sender registration, recipient preferences and applicable messaging requirements.', docs: 'https://www.twilio.com/docs/messaging/compliance/a2p-10dlc', accountDocs: 'https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account', carrier: 'COM-003' },
  { id: 'acrobat-sign', name: 'Acrobat Sign', unit: 'signature transactions', plan: 'Production Acrobat Sign subscription with API entitlement; confirm with Adobe. A free Developer Edition is for development and demonstration, not a production entitlement.', app: 'Acrobat Sign API application/OAuth and an authorized sender. Enterprise technical accounts require the API Available entitlement.', legal: 'Employer-reviewed electronic-signature consent, approved document, signer identity and evidence/retention requirements.', docs: 'https://developer.adobe.com/acrobat-sign/docs/overview/developer_guide/', accountDocs: 'https://helpx.adobe.com/sign/web/administers/user-provisioning/technical-account.html', carrier: 'OFFER-003' },
  { id: 'checkr', name: 'Checkr', unit: 'background-check packages', plan: 'Credentialed Checkr customer account with the chosen package and authorized production API access; obtain employer-specific package and additional-fee pricing from Checkr.', app: 'Checkr production API approval and credentials; Checkr reviews required consent/disclosure capture before production access.', legal: 'Employer legal review of FCRA disclosure/authorization, permissible purpose, adverse-action process and applicable state/local fair-chance requirements. Setup is not legal certification.', docs: 'https://docs.checkr.com/', accountDocs: 'https://docs.checkr.com/', carrier: 'HIRE-002' },
] as const

function provider(id: unknown) { return PROVIDERS.find(p => p.id === oneOf(id, PROVIDERS.map(p => p.id), 'Provider'))! }

/** Decimal USD kept as integer millionths. Round once, per monthly line, to the nearest cent. */
function usd(value: unknown, label: string, decimals: number) {
  const raw = typeof value === 'number' ? String(value) : value
  requireThat(typeof raw === 'string' && new RegExp(`^\\d{1,9}(?:\\.\\d{1,${decimals}})?$`).test(raw), `${label} must be USD with up to ${decimals} decimal places`)
  const [whole, fraction = ''] = raw.split('.')
  return { raw, micros: BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')) }
}

export function providerSetup(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const p = provider(b.provider), current = s.find('provider-setup', p.id)
  if (b.enabled === false) {
    const record = s.put('provider-setup', p.id, { ...current, enabled: false, reviewed: null, updatedBy: a.email, updatedAt: now() })
    s.audit(a, 'provider-setup-disabled', 'provider-setup:' + p.id)
    return record
  }
  const unit = usd(b.unitPriceUsd, 'Employer-entered unit price', 6), recurring = usd(b.monthlyBaseUsd, 'Monthly fixed cost', 2), setup = usd(b.oneTimeUsd ?? '0', 'One-time setup cost', 2)
  const volume = integer(b.volume, 'Expected monthly volume', 0, 1000000000)
  const amount = (unit.micros * BigInt(volume) + recurring.micros + 5000n) / 10000n
  requireThat(amount <= BigInt(Number.MAX_SAFE_INTEGER), 'Monthly estimate is too large')
  const record = s.put('provider-setup', p.id, { enabled: true, plan: text(b.plan, 'Employer plan/package', 200), volume,
    unitPriceUsd: unit.raw, monthlyBaseUsd: recurring.raw, oneTimeUsd: setup.raw, monthlyCents: Number(amount), oneTimeCents: Number(setup.micros / 10000n),
    priceBasis: text(b.priceBasis, 'Pricing source and date', 300), planConfirmed: b.planConfirmed === true, appConfirmed: b.appConfirmed === true, legalConfirmed: b.legalConfirmed === true,
    reviewed: null, updatedBy: a.email, updatedAt: now() })
  s.audit(a, 'provider-setup-saved', 'provider-setup:' + p.id, { monthlyCents: record.monthlyCents, planConfirmed: record.planConfirmed })
  return record
}

/** Shared operational precondition. Future adapters must call this before any provider attempt. */
export function requireProviderPlan(s: State, id: string) {
  const p = provider(id), setup = s.find('provider-setup', p.id)
  requireThat(setup?.enabled, `${p.name}: enable provider setup first`, 409)
  requireThat(setup.planConfirmed, `${p.name}: missing employer confirmation of the required provider plan`, 409)
  requireThat(setup.appConfirmed, `${p.name}: missing employer confirmation of required app/API access`, 409)
  requireThat(setup.legalConfirmed, `${p.name}: missing employer confirmation of legal configuration review`, 409)
  return setup
}

/** Review the exact saved setup, without pretending an unavailable adapter is connected. */
export async function reviewProviderSetup(s: State, a: Actor, b: Data) {
  requireAdmin(a)
  const p = provider(b.provider), setup = requireProviderPlan(s, p.id)
  requireThat(b.version === await sha256(canonical(setup)), `${p.name}: setup changed; review the current estimate`, 409)
  const record = s.put('provider-setup', p.id, { ...setup, reviewed: { by: a.email, at: now() } })
  s.audit(a, 'provider-setup-reviewed', 'provider-setup:' + p.id)
  return record
}

export async function providerSummary(s: State) {
  const catalog = await Promise.all(PROVIDERS.map(async p => {
    const setup = s.find('provider-setup', p.id) ?? null
    return { ...p, setup, version: setup ? await sha256(canonical(setup)) : null, connection: 'Connector unavailable; setup and estimate only' }
  }))
  const lines = catalog.filter(p => p.setup?.enabled)
  const totalMonthlyCents = lines.reduce((sum, p) => sum + p.setup!.monthlyCents, 0)
  requireThat(Number.isSafeInteger(totalMonthlyCents), 'Combined monthly estimate is too large')
  return { catalog, lines, totalMonthlyCents, currency: 'USD', note: 'Employer-entered estimates, not provider quotes. Monthly = entered volume × entered unit rate + entered fixed monthly fees, rounded once per line to cents. Enter carrier, platform and package extras in the applicable rate or fixed fee. One-time fees are separate; taxes, actual usage and exchange charges may differ. No account, purchase, send or connection is created here.' }
}
