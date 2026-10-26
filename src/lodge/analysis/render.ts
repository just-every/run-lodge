import { esc, page } from '../http/public'
import { times } from '../core/time'
import { METRICS, GROUPS, defaultQuery, type Query } from './query'
import type { AnalysisScope } from './scope'
import type { Result } from './execute'
import type { providerStatus } from './provider'

type Status = ReturnType<typeof providerStatus>
const option = (id: string, label: string, current: string | string[]) => `<option value="${esc(id)}"${(Array.isArray(current) ? current.includes(id) : current === id) ? ' selected' : ''}>${esc(label)}</option>`
const input = (label: string, name: string, value: unknown, type = 'text', attrs = '') => `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`
const when = (value: string | null, zone: string) => value ? `<time datetime="${esc(value)}">${esc(times(zone).stamped(value))}</time><br><code>${esc(value)}</code>` : 'Not recorded'
const fields = (entries: [string, unknown][]) => `<dl class="application-email-facts">${entries.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`

export function queryForm(scope: AnalysisScope, q: Query, title = '', save = false) {
  const sources = [...new Set([...scope.sources, ...q.sources])].sort()
  return `<form method="post" action="/analysis/preview"><fieldset><legend>Editable query definition</legend>
<label>Metric<select aria-label="Metric" name="metric" required>${Object.entries(METRICS).map(([id, metric]) => option(id, metric.label, q.metric)).join('')}</select></label>
${input('From date (inclusive)', 'from', q.from, 'date', 'required')}${input('Through date (inclusive)', 'to', q.to, 'date', 'required')}
<label>Job filters<select aria-label="Job filters" name="jobs" multiple size="3">${scope.jobs.map(j => option(j.id, j.title, q.jobs)).join('')}</select><small>No selection means all jobs you currently run. Select more than one with the platform selection key.</small></label>
<label>Source filters<select aria-label="Source filters" name="sources" multiple size="3">${sources.map(s => option(s, s, q.sources)).join('')}</select><small>No selection means all recorded sources in your current scope.</small></label>
<label>Group by<select aria-label="Group by" name="groupBy" required>${Object.entries(GROUPS).map(([id, label]) => option(id, label, q.groupBy)).join('')}</select><small>Source conversion and scheduling support source, job or all records. Stage moves also support destination stage; offers also support offer outcome.</small></label>
<label>Chart display<select aria-label="Chart display" name="chart" required>${option('bar', 'Bar chart and data table', q.chart)}${option('table', 'Data table', q.chart)}</select></label>
<button type="submit">Preview edited query</button>
${save ? `${input('Chart name', 'title', title || METRICS[q.metric].label + ' · ' + q.from + ' to ' + q.to, 'text', 'maxlength="120"')}<p>Saving creates a new definition. Existing saved charts remain available as prior versions. Reopening always recomputes current evidence.</p><button type="submit" formaction="/analysis/save">Save chart definition</button>` : ''}
</fieldset></form>`
}
function resultCard(scope: AnalysisScope, r: Result, i: number, title?: string) {
  const metric = METRICS[r.query.metric], unit = r.unit === 'percent' ? '%' : r.unit === 'hours' ? ' hours' : ' ' + r.unit
  const value = (n: number | null) => n === null ? 'No data' : String(n) + unit
  const max = Math.max(1, ...r.groups.map(g => g.value ?? 0))
  const bars = r.query.chart === 'bar' && r.groups.length ? `<figure aria-label="${esc(metric.label)} bar chart">${r.groups.map(g => `<p><strong><code>${esc(g.label)}</code></strong> · ${esc(value(g.value))}</p><svg width="100%" height="20" viewBox="0 0 600 20" preserveAspectRatio="none" role="img" aria-label="${esc(g.label + ': ' + value(g.value))}"><rect x="0" y="0" width="${Math.round((g.value ?? 0) / max * 600)}" height="20" fill="currentColor"/></svg>`).join('')}<figcaption>Bars share a zero baseline. Exact values and denominators appear below.</figcaption></figure>` : ''
  const groupRows = [...r.groups, r.total].map(g => `<tr><th scope="row"><code>${esc(g.label)}</code></th><td>${esc(value(g.value))}</td><td>${r.query.metric === 'source_conversion' ? `${g.numerator} converted of ${g.denominator} applications` : `${g.denominator} ${r.query.metric === 'scheduling_delay' ? 'bookings' : 'records'}`}</td></tr>`).join('')
  const jobNames = r.query.jobs.map(id => scope.jobs.find(j => j.id === id)?.title ?? 'Unavailable')
  return `<article aria-label="${esc(metric.label)} result" id="result-${i}"><h2>${esc(title || metric.label)}</h2><p>${esc(r.definition)}</p>
${fields([['Date cohort', r.query.from + ' through ' + r.query.to + ' inclusive'], ['Business time zone', r.zone], ['Job filters', jobNames.length ? jobNames.join(', ') : 'All currently authorized managed jobs'], ['Source filters', r.query.sources.length ? r.query.sources.join(', ') : 'All scoped sources'], ['Grouping', GROUPS[r.query.groupBy]], ['Total', value(r.total.value)]])}
<p>Exact interval: <code>${esc(r.start)}</code> inclusive to <code>${esc(r.endExclusive)}</code> exclusive.</p><p>Freshness: recomputed from retained local records at ${when(r.computedAt, r.zone)}. This is not a live check of external systems.</p>
${bars}<div class="sign-doc analysis-totals" role="region" aria-label="${esc(metric.label)} totals" tabindex="0"><table><caption>${esc(metric.label)} totals</caption><thead><tr><th scope="col">Group</th><th scope="col">Value</th><th scope="col">Population</th></tr></thead><tbody>${groupRows}</tbody></table></div>
<details class="disclosure" open><summary>Definitions, freshness and limitations</summary><p>Missing or invalid event timestamps excluded: <strong>${r.missing}</strong>. For records whose cohort timestamp is absent, this count covers the selected job and source scope because the date cohort cannot be determined.</p><ul>${r.limitations.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>Totals use all ${r.evidenceTotal} matching source rows. Evidence display limit: ${r.evidenceLimit}; shown: ${r.evidence.length}. ${r.evidenceTruncated ? 'The evidence display is truncated; totals are not sampled.' : 'No matching evidence rows were omitted from the display.'}</p><p>Model metadata is limited to 100 job and 100 source choices. The model receives no source rows.</p></details>
<details class="disclosure"><summary>Underlying source rows (${r.evidence.length} shown)</summary><p>Compare row identifiers and times with the native records. Only safe scalar event evidence is shown.</p>
<p>Scroll the evidence table horizontally to compare complete identifiers and event times.</p><div class="sign-doc analysis-evidence" role="region" aria-label="${esc(metric.label)} underlying source rows" tabindex="0"><table><caption>Retained source rows</caption><thead><tr><th scope="col">Record and application</th><th scope="col">Job and source</th><th scope="col">Cohort event time</th><th scope="col">Related event and time</th><th scope="col">Contribution</th></tr></thead><tbody>${r.evidence.map(row => `<tr><td><code>${esc(row.record)}</code><br>Application <code>${esc(row.application)}</code></td><td><code>${esc(row.job)}</code><br><code>${esc(row.source)}</code></td><td>${when(row.at, r.zone)}</td><td>${row.event ? `<code>${esc(row.event)}</code><br>` : ''}${when(row.relatedAt, r.zone)}</td><td>${esc(row.value)}<br>${esc(row.outcome)}</td></tr>`).join('') || '<tr><td colspan="5">No matching source rows.</td></tr>'}</tbody></table></div></details>
${queryForm(scope, r.query, title, true)}</article>`
}
export async function analysisDocument(scope: AnalysisScope, saved: { id: string; title: string; createdAt: string }[], status: Status, results: Result[] = [], extra: { error?: string; savedId?: string; title?: string; status?: number } = {}) {
  const response = await page('Recruiting analysis', `<h1>Recruiting analysis</h1><p><a href="/app">Back to workspace</a> · <a href="/analysis">New analysis</a> · <a href="/analysis/setup">Analysis provider setup</a> · <a href="/analysis/schedules">Scheduled chart delivery</a></p>
${extra.error ? `<p role="alert">${esc(extra.error)}</p>` : ''}${extra.savedId ? `<p role="status">Chart definition saved. <a href="/analysis/saved/${esc(extra.savedId)}">Reopen saved chart</a> · <a href="/analysis/schedules/new?chart=${esc(extra.savedId)}">Schedule reviewed delivery</a></p>` : ''}
<p>Ask a recruiting question to create editable charts over authorized stage events, scheduling, sources and offer outcomes. Charts do not make or change hiring decisions.</p>
<p>Provider: ${status.ready ? 'Reviewed and enabled' : esc(status.reason)}</p>
<form action="/analysis/interpret" method="post"><label>Recruiting question<textarea name="question" rows="3" maxlength="1000" required placeholder="Show last-quarter source conversion and scheduling delay"></textarea></label><p>Submitting sends this question and safe metric and filter metadata to the configured model. No hiring source rows are sent. This explicit action may incur a provider charge.</p><button type="submit">Interpret recruiting question</button></form>
<p>Last quarter in ${esc(scope.dates.zone)}: ${esc(scope.dates.lastQuarter.from)} through ${esc(scope.dates.lastQuarter.to)} inclusive.</p>
${results.map((r, i) => resultCard(scope, r, i, extra.title)).join('')}
${!results.length ? `<details class="disclosure"><summary>Build an editable query</summary>${queryForm(scope, defaultQuery(scope))}</details>` : ''}
<h2>Saved chart definitions</h2><p>Each saved definition belongs to the signed-in operator. Open an earlier definition to restore its query; evidence is always recomputed with current access.</p>${saved.length ? `<ul class="downloads">${saved.map(s => `<li><a href="/analysis/saved/${esc(s.id)}"><code>${esc(s.title)}</code></a> · ${esc(times(scope.dates.zone).stamped(s.createdAt))}</li>`).join('')}</ul>` : '<p>No saved chart definitions.</p>'}`, extra.status ?? 200)
  return new Response((await response.text()).replace('</head>', '<link rel="stylesheet" href="/lodge-analysis.css"></head>'), { status: response.status, headers: response.headers })
}
