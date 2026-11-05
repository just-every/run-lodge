import assert from 'node:assert/strict'

// Only the verifier's disposable mail edge is controlled. The signed roster
// creates the account and binding; confirmation and suspension use native HTTP.
let reviewers, confirmation, sponsor
export function configureSponsorSession(value) {
  reviewers = value
  confirmation = undefined
  sponsor = undefined
}

const sessionCookie = response => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
async function json(request, origin, path, cookie) {
  const response = await request(origin + path, {headers: {Cookie: cookie}})
  assert.equal(response.status, 200, 'Native sponsor read succeeds')
  return response.json()
}

export default async function ({request, origin, email, sub, label, owner, mail, database}) {
  // The captured-mail reviewer callback runs after the verifier has applied its
  // signed Business roster. Never pre-create an unrelated same-address account.
  if (!sub) {
    const invitations = mail.read().filter(message => message.text.includes('/auth/confirm?'))
    assert.equal(invitations.length, 1, 'Signed roster sent one native invitation')
    const link = invitations[0].text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)?.[0]
    assert.ok(link, 'The native invitation contains a confirmation link')
    const url = new URL(link)
    assert.equal(url.origin, origin)
    const preview = await request(url.href)
    assert.equal(preview.status, 200)
    assert.equal(sessionCookie(preview), '', 'Preview does not sign in')
    await preview.body.cancel()
    const response = await request(origin + '/auth/confirm', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify({token: url.searchParams.get('token')})})
    assert.equal(response.status, 303, 'Native confirmation issues the sponsor session')
    assert.ok(sessionCookie(response))
    confirmation = response
    return response
  }

  await reviewers.initialize(label, owner)
  assert.ok(confirmation, 'Return the native confirmation response')
  const cookie = sessionCookie(confirmation)
  const {operator} = await json(request, origin, '/auth/session', cookie)
  assert.equal(operator.email, email)
  assert.equal(operator.status, 'active')
  assert.notEqual(operator.role, 'owner')
  const state = await json(request, origin, '/api/lodge/state', owner.cookie)
  const member = state.members.find(person => person.email === email)
  assert.ok(member?.active && !member.agent && !member.owner, 'Signed roster created an eligible native human member')
  // Read-only corroboration of the signed public-door write, never SQL setup.
  const db = await database('DB')
  const binding = await db.prepare('SELECT business_id,operator_id,state FROM bs_team WHERE business_id=?').bind(sub).first()
  assert.equal(binding?.operator_id, operator.id)
  assert.notEqual(binding.state, 'conflict')
  sponsor = {sub, email, operatorId: operator.id, cookie, origin}
  return confirmation
}

export async function inactiveSponsor({request, origin, cookie}) {
  assert.equal(sponsor?.origin, origin, 'Sponsor belongs to this disposable installation')
  const response = await request(origin + '/auth/operator/status', {method: 'POST', headers: {Origin: origin, Cookie: cookie, 'Content-Type': 'application/json'}, body: JSON.stringify({operatorId: sponsor.operatorId, status: 'inactive'})})
  assert.equal(response.status, 200, 'Owner suspends the native operator')
  const operator = await response.json()
  assert.equal(operator.id, sponsor.operatorId)
  assert.equal(operator.status, 'inactive')
  await assertInactiveSponsor({request, origin, cookie})
  // No session, token, agent id or signing key crosses the fixture interface.
  return {sub: sponsor.sub, email: sponsor.email}
}

export async function assertInactiveSponsor({request, origin, cookie}) {
  assert.equal(sponsor?.origin, origin)
  const operators = await json(request, origin, '/auth/operators', cookie)
  const operator = operators.find(person => person.id === sponsor.operatorId)
  assert.equal(operator?.status, 'inactive')
  assert.equal(operator.email, sponsor.email)
  const state = await json(request, origin, '/api/lodge/state', cookie)
  assert.equal(state.members.find(person => person.email === sponsor.email)?.active, true, 'Refusal isolates native operator suspension, not missing Lodge membership')
  const revoked = await request(origin + '/auth/session', {headers: {Cookie: sponsor.cookie}})
  assert.equal(revoked.status, 401, 'Suspension revokes the previously confirmed native session')
  await revoked.body.cancel()
}
