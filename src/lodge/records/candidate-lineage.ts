import type { Data } from '../core/types'

/** Merges keep their original links, so C can still point to B after B joins A. */
export function mergedCandidates(people: Data[], candidateId: string) {
  const ids = new Set([candidateId])
  let expanded = true
  while (expanded) {
    expanded = false
    for (const person of people) if (ids.has(person.mergedInto) && !ids.has(person.id)) {
      ids.add(person.id); expanded = true
    }
  }
  return people.filter(person => person.id !== candidateId && ids.has(person.id))
}
