import { isAdmin } from '../core/access'
import { esc, page } from '../http/public'
import { requireThat, type Actor, type Data } from '../core/types'
import type { ProviderReview } from './provider'
import { providerStatus, reviewDraft } from './provider'
import type { State } from '../core/state'

export function setupAccess(a: Actor) {
  requireThat(!a.agent && isAdmin(a), 'Only a native owner or hiring admin can configure analysis', 403)
}
const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${esc(value)}">`
const input = (label: string, name: string, value: unknown, attrs = '') => `<label>${esc(label)}<input name="${name}" value="${esc(value)}" ${attrs} required></label>`
export function setupDocument(s: State, env: Record<string, unknown>, preview?: ReturnType<typeof reviewDraft>, saved = false) {
  const status = providerStatus(s, env), current = preview ?? status.review
  const tuple = status.tuple
  return page('Analysis provider setup', `<h1>Analysis provider setup</h1><p><a href="/analysis">Recruiting analysis</a> · <a href="/app">Back to workspace</a></p>${saved ? '<p role="status">Analysis provider settings saved.</p>' : ''}
<p>Recruiting analysis starts off. No question is sent automatically. A person explicitly submits each question after this capability has been enabled.</p><p>${status.ready ? 'Recruiting analysis is reviewed and enabled.' : esc(status.reason)}</p>
<h2>Configured provider</h2>${tuple ? `<dl class="application-email-facts"><dt>Transport</dt><dd>${esc(tuple.transport)}</dd><dt>Base URL</dt><dd><code>${esc(tuple.baseUrl)}</code></dd><dt>Exact model</dt><dd><code>${esc(tuple.model)}</code></dd></dl><p>Credentials are held by installation configuration and are never stored in these settings. Changing transport, base URL or model requires a fresh review.</p>` : '<p>Configure one provider transport and model in installation settings before previewing an estimate.</p>'}
${preview ? `<section aria-label="Analysis estimate preview"><h2>Review the USD estimate</h2><p>Estimated monthly provider charge: <strong>USD ${preview.monthlyUsd.toFixed(6)}</strong>.</p><p>${preview.monthlyQuestions} questions × (${preview.inputTokens} input tokens × USD ${preview.inputUsd} per million + ${preview.outputTokens} output tokens × USD ${preview.outputUsd} per million).</p><p>Rate basis: ${esc(preview.rateBasis)}</p><p>Actual provider usage and bills can differ. This estimate is not a budget cap. Output is limited to 1,600 tokens per question; input includes metric and scoped filter metadata in addition to the question.</p><form method="post" action="/analysis/setup">${Object.entries(preview).filter(([k]) => k !== 'monthlyUsd').map(([k, v]) => hidden(k, v)).join('')}${hidden('employerPlan', 'yes')}${hidden('appAccess', 'yes')}${hidden('legalReviewed', 'yes')}<label><input type="checkbox" name="reviewed" value="yes" required> I reviewed this exact provider, model, volume, USD rates and monthly estimate.</label><label><input type="checkbox" name="enabled" value="yes" required> Enable recruiting analysis for explicit questions</label><button>Enable reviewed analysis provider</button></form></section>` : ''}
${tuple ? `<h2>${preview ? 'Revise the estimate' : 'Prepare a provider review'}</h2><form method="post" action="/analysis/setup/preview">${input('Estimated questions per month', 'monthlyQuestions', current?.monthlyQuestions ?? '', 'type="number" min="0" max="1000000" step="1"')}${input('Estimated input tokens per question', 'inputTokens', current?.inputTokens ?? '', 'type="number" min="1" max="1000000" step="1"')}${input('Estimated output tokens per question', 'outputTokens', current?.outputTokens ?? '', 'type="number" min="1" max="1600" step="1"')}${input('USD per million input tokens', 'inputUsd', current?.inputUsd ?? '', 'type="number" min="0" max="10000" step="any"')}${input('USD per million output tokens', 'outputUsd', current?.outputUsd ?? '', 'type="number" min="0" max="10000" step="any"')}${input('USD rate basis and date', 'rateBasis', current?.rateBasis ?? '', 'maxlength="500"')}
<label><input type="checkbox" name="employerPlan" value="yes" required> Our employer plan permits this provider capability.</label><label><input type="checkbox" name="appAccess" value="yes" required> Our application has access to this configured model.</label><label><input type="checkbox" name="legalReviewed" value="yes" required> Our employer reviewed the legal and data terms for sending questions and safe filter metadata.</label><button>Preview analysis cost estimate</button></form>` : ''}
${status.review ? '<form method="post" action="/analysis/setup/disable"><button>Disable recruiting analysis</button></form>' : ''}`)
}
export function providerPublicReview(review: Data | ProviderReview | undefined) {
  if (!review) return null
  const { model, transport, baseUrl, monthlyQuestions, inputTokens, outputTokens, inputUsd, outputUsd, rateBasis, monthlyUsd, enabled, reviewedAt } = review
  return { model, transport, baseUrl, monthlyQuestions, inputTokens, outputTokens, inputUsd, outputUsd, rateBasis, monthlyUsd, enabled, reviewedAt }
}
