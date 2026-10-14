/** Native merges retain immediate edges: C -> B -> A, A:[B], B:[C]. */
export function validateCandidateLineage(candidates, refuse) {
 const people = new Map(candidates.map(person => [person.id, person]));
 const targets = new Map();
 for (const person of candidates) {
  if (Object.hasOwn(person, 'mergedInto')) {
   refuse(typeof person.mergedInto === 'string' && people.has(person.mergedInto) && person.mergedInto !== person.id);
   refuse(!person.deleted && !people.get(person.mergedInto).deleted);
   targets.set(person.id, person.mergedInto);
  }
  if (Object.hasOwn(person, 'mergedFrom')) {
   refuse(Array.isArray(person.mergedFrom));
   refuse(new Set(person.mergedFrom).size === person.mergedFrom.length);
   for (const id of person.mergedFrom) refuse(typeof id === 'string' && people.has(id) && people.get(id).mergedInto === person.id);
  }
 }
 const complete = new Set();
 for (const person of candidates) {
  const path = new Set();
  let id = person.id;
  while (targets.has(id) && !complete.has(id)) {
   refuse(!path.has(id));
   path.add(id);
   id = targets.get(id);
  }
  for (const seen of path) complete.add(seen);
 }
}
