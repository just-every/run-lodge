import assert from 'node:assert/strict'
import { recordSnapshot, transactions } from './record-transactions.mjs'

export async function checkMerge(h, firstVacancy, secondVacancy) {
 const cmd = h.command
 const add = async name => (await cmd('candidate', { name, email:'same@example.test', source:'Direct', consentBasis:'manual' })).candidate
 const a=await add('Merge person'), b=await add('Merge person')
 const apply = (candidate,vacancy) => cmd('apply',{candidate:candidate.id,vacancy:vacancy.id,source:'Chosen role'})
 const apps = [await apply(a,firstVacancy),await apply(b,firstVacancy),await apply(a,secondVacancy),await apply(b,secondVacancy)]
 const input={keep:a.id,other:b.id,decision:'merge',reason:'Confirmed duplicate'}
 const refuse = async () => {
  const before=await recordSnapshot(h)
  assert.equal((await h.send('/api/lodge/command/review-duplicate',input,h.owner)).status,409)
  assert.deepEqual(await recordSnapshot(h),before,'overlap refusal changes neither rows nor audits')
 }
 await refuse()
 await cmd('move',{application:apps[1].id,to:'withdrawn',closeReason: 'other-offer', reason:'Resolve first overlapping vacancy'})
 await refuse()
 await cmd('move',{application:apps[2].id,to:'rejected',closeReason: 'skills', reason:'Resolve second overlapping vacancy'})
 const historyBefore=(await recordSnapshot(h)).filter(r=>r.kind==='stage-event'&&apps.some(a=>a.id===JSON.parse(r.value).application))
 await cmd('review-duplicate',input)
 const current=(await h.state()).applications.filter(app=>app.candidate===a.id)
 assert.deepEqual(current.map(a=>a.id).sort(),apps.map(a=>a.id).sort(),'all application ids survive, closed and active')
 assert.equal(current.filter(a=>a.status==='active').length,2)
 assert.deepEqual((await recordSnapshot(h)).filter(r=>historyBefore.some(old=>old.kind===r.kind&&old.id===r.id)),historyBefore,'entire original stage history survives')
 const tx=await transactions(h)
 try {
  const c=await add('Race person'),d=await add('Race duplicate')
  await apply(c,firstVacancy)
  const merge={keep:c.id,other:d.id,decision:'merge',reason:'Race duplicate decision'}
  const pendingMerge=await tx.prepare('review-duplicate',merge)
  await apply(d,firstVacancy)
  await tx.refuse(pendingMerge)
  const e=await add('Other race person')
  const one=await tx.prepare('apply',{candidate:e.id,vacancy:firstVacancy.id,source:'Prepared'})
  await apply(e,firstVacancy)
  await tx.refuse(one)
  const f=await add('Merge incoming applicant')
  const pendingApply=await tx.prepare('apply',{candidate:f.id,vacancy:firstVacancy.id,source:'Prepared before merge'})
  await cmd('review-duplicate',{keep:e.id,other:f.id,decision:'merge',reason:'Merge before incoming application'})
  await tx.refuse(pendingApply)
 } finally {await tx.close()}
}
