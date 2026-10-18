import type { Bindings } from './auth.server'
import { demoRecords } from './demo-data'
import { demoActivity, spreader } from './demo-activity'

/** Fixed IDs make the hook safe to repeat without overwriting a visitor's edits. */
export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }) {
  const spread = spreader()
  const rows = await demoActivity(await demoRecords(ownerEmail, now, spread), ownerEmail, now, spread)
  await env.DB.batch([env.DB.prepare("INSERT INTO oa_first_run(singleton,completed_by,completed_at) SELECT 1,id,? FROM oa_operators WHERE email=? AND role='owner' AND status='active' ON CONFLICT(singleton) DO NOTHING").bind(now.getTime(), ownerEmail), ...rows.map(row => env.DB.prepare('INSERT INTO l_records(kind,id,revision,value) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO NOTHING').bind(row.kind, row.id, row.revision, JSON.stringify(row.value)))])
}
