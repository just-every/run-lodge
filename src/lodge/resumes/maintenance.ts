import { runtimeBindings, type Bindings } from '../../auth.server'
import { loadKinds, save } from '../core/store'
import { expireIntakes } from './lifecycle'

export async function resumeIntakeMaintenance(controller: ScheduledController, bindings: Bindings) {
 const { DB } = runtimeBindings(bindings)
 // Expiry reads only the uploads themselves (their status and deadline), never the people or jobs.
 const state = await loadKinds(DB, ['resume-intake'])
 expireIntakes(state, controller.scheduledTime)
 await save(DB, state, null)
}
