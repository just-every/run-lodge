import { runtimeBindings, type Bindings } from '../../auth.server'
import { load, save } from '../core/store'
import { expireIntakes } from './lifecycle'

export async function resumeIntakeMaintenance(controller: ScheduledController, bindings: Bindings) {
 const { DB } = runtimeBindings(bindings)
 const state = await load(DB)
 expireIntakes(state, controller.scheduledTime)
 await save(DB, state, null)
}
