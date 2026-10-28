import type { Data } from '../core/types'

const dated = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const elapsed = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3600000

/** Replay recorded declarations, never reconstruct who answered from today's availability. */
export function schedulingWaits(iv: Data, imported: boolean) {
  const observations: Data[] = iv.observations ?? []
  const proposal = observations.findIndex(e => e.kind === 'proposed' && dated(e.at) && e.at === iv.createdAt)
  const measured = (hours: number, indices: number[]) => ({ hours, observations: indices })
  const unknown = (): { hours: number | null; observations: number[] } => ({ hours: null, observations: [] })
  const waits = { candidate: unknown(), panel: unknown(), readyToSchedule: unknown() }
  if (imported || proposal < 0) return waits
  const scheduled = observations.findIndex(e => e.kind === 'scheduled' && dated(e.at) && e.at === iv.scheduledAt)
  const end = scheduled < 0 ? observations.length : scheduled
  const firstPanel = new Map<number, number>(), declarations = new Map<number | 'candidate', number[]>()
  let ready = -1, previous = iv.createdAt, panelHistoryIncomplete = false
  for (let index = proposal + 1; index < end; index++) {
    const event = observations[index]
    // Inconsistent timing is missing evidence, not a negative or invented duration.
    if (!dated(event.at) || Date.parse(event.at) < Date.parse(previous)) return { candidate: unknown(), panel: unknown(), readyToSchedule: unknown() }
    previous = event.at
    if (event.kind === 'candidate-availability') {
      if (waits.candidate.hours === null) waits.candidate = measured(elapsed(iv.createdAt, event.at), [proposal, index])
      declarations.set('candidate', event.slots ?? [])
    } else if (event.kind === 'panel-availability' && Number.isInteger(event.participant) && event.participant >= 0 && event.participant < iv.participants.length) {
      if (!firstPanel.has(event.participant)) firstPanel.set(event.participant, index)
      declarations.set(event.participant, event.slots ?? [])
      if (!panelHistoryIncomplete && waits.panel.hours === null && firstPanel.size === iv.participants.length) waits.panel = measured(elapsed(iv.createdAt, event.at), [proposal, ...firstPanel.values()])
    } else if (event.kind === 'panel-availability') {
      panelHistoryIncomplete = true
      waits.panel = unknown()
      // An unattributed older edit may withdraw any panellist's availability.
      for (const participant of [...declarations.keys()]) if (participant !== 'candidate') declarations.delete(participant)
    }
    if (scheduled >= 0) {
      const slot = observations[scheduled].slot
      const allAvailable = declarations.size === iv.participants.length + 1 && [...declarations.values()].every(slots => slots.includes(slot))
      if (!allAvailable) ready = -1
      else if (ready < 0) ready = index
    }
  }
  if (scheduled >= 0 && ready >= 0 && Date.parse(iv.scheduledAt) >= Date.parse(previous)) {
    waits.readyToSchedule = measured(elapsed(observations[ready].at, iv.scheduledAt), [ready, scheduled])
  }
  return waits
}

export function schedulingSummary(cases: Data[]) {
  const interviews = cases.flatMap(row => row.scheduling)
  return (['candidate', 'panel', 'readyToSchedule'] as const).map(metric => {
    const rows = interviews.filter(iv => iv.waits[metric].hours !== null)
    return { metric, interviews: interviews.length, measured: rows.length, unknown: interviews.length - rows.length,
      meanHours: rows.length ? rows.reduce((sum, iv) => sum + iv.waits[metric].hours, 0) / rows.length : null }
  })
}

/** A trial compares the same named observation and denominator as its reviewed baseline. */
export function delayMetric(report: Data, metric: string, stage: string): Data | undefined {
  if (metric === 'mean-completed-stage-hours') {
    const row = report.stages.find((x: Data) => x.stage === stage)
    return row && { label: row.label, meanHours: row.meanHours, samples: row.intervals, sampleLabel: 'completed visits', definition: report.definitions.stages }
  }
  if (metric === 'mean-recorded-offer-outcome-hours') return { label: 'Recorded offer outcomes', meanHours: report.totals.meanOfferHours, samples: report.totals.measuredOutcomes, sampleLabel: 'recorded offers', definition: report.definitions.offers }
  if (metric === 'mean-submission-to-acceptance-hours') return { label: 'Submission to recorded acceptance', meanHours: report.hiring.elapsed.meanHours, samples: report.hiring.elapsed.measuredApplications, sampleLabel: 'applications with recorded acceptance', definition: report.definitions.hiring }
  const key = ({ 'mean-candidate-availability-hours': 'candidate', 'mean-panel-declaration-hours': 'panel', 'mean-ready-to-schedule-hours': 'readyToSchedule' } as Record<string, string>)[metric]
  const row = key && report.scheduling?.find((x: Data) => x.metric === key)
  return row ? { label: ({ candidate: 'Candidate availability', panel: 'Complete panel declarations', readyToSchedule: 'Ready to recorded schedule' } as Record<string, string>)[key], meanHours: row.meanHours, samples: row.measured, sampleLabel: 'interviews', definition: report.definitions.waits } : undefined
}
