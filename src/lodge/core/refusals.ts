import type { Fault } from './types'

/** Stable business refusals shared by native preparation and its agent adapter.
 * Use only the status: hidden records must disclose no more than missing ones.
 */
export function nativeRefusalCode(error: Fault): 'record_unavailable' | 'native_conflict' | 'native_refused' {
  return error.status === 404 ? 'record_unavailable' : error.status === 409 ? 'native_conflict' : 'native_refused'
}
