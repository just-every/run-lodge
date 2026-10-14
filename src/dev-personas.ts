import type { DevPersona } from './modules/operator-auth/dev/index.mjs'

// Local dev personas: real operators at <as>@dev.localhost, created only by
// local dev sign-in and suspended in exports. Only src/server.dev.ts uses them.
// Each still needs a Lodge membership: the owner adds it under People with the
// matching role (the agent persona is a separate member so a person, not the
// agent, approves its proposals).
export function devPersonas(): DevPersona[] {
 return [
  { as: 'admin', role: 'member', displayName: 'Avery Admin (hiring admin)' },
  { as: 'manager', role: 'member', displayName: 'Morgan Lee (hiring manager)' },
  { as: 'interviewer', role: 'member', displayName: 'Ivy Chen (interviewer)' },
  { as: 'approver', role: 'member', displayName: 'Parker Jones (approver)' },
  { as: 'agent', role: 'member', displayName: 'Coding agent (proposals only)' },
 ]
}
