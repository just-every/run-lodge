import type { PageProps } from './app'
import type { D } from './shared'

/** Notice configuration stays in Settings, using existing job and contact authority. */
export function ChannelSettings({ w }: PageProps) {
  if (w.actor.agent) return null
  const apps = w.applications.filter((app: D) => {
    const job = w.vacancies.find((j: D) => j.id === app.vacancy)
    return job?.manages && job.permissions.includes('contact') && job.permissions.includes('settings')
  })
  if (!apps.length) return null
  return <section aria-label="Channel consent settings" className="card">
    <h2>Channel consent settings</h2>
    <p>Review separate SMS and WhatsApp notices for each application. Candidates choose in their own signed-in account. Local evidence does not authorize messaging.</p>
    <ul>{apps.map((app: D) => <li key={app.id}><a href={'/candidate/employer/' + app.id + '/channels'}>{app.candidateName} · {w.vacancies.find((j: D) => j.id === app.vacancy)?.title}</a></li>)}</ul>
  </section>
}
