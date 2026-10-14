import assert from 'node:assert/strict'
import { recordSnapshot, transferSnapshot, transactions } from './record-transactions.mjs'
import { createPortability, readArchive } from '@runeditrun/rer/modules/portability'
import { policy } from '../scripts/installer/portability-policy.mjs'

export async function checkErasure(h, vacancy, manager) {
 const cmd=h.command, marker='CANDIDATE-PRIVATE-RETENTION-EVIDENCE'
 const add = async (name,source='Direct') => cmd('candidate',{name,email:name.replaceAll(' ','').toLowerCase()+'@example.test',source,consentBasis:'manual',vacancy:vacancy.id})
 const a=await add('Erasure A',marker),b=await add('Erasure B',marker),c=await add('Erasure C',marker)
 await cmd('correct-candidate',{...a.candidate,reason:marker})
 const requests=[]
 for (const person of [a,b,c]) requests.push(await cmd('data-request',{candidate:person.candidate.id,type:'deletion',note:marker,channel:marker}))
 await cmd('complete-data-request',{id:requests[1].id,outcome:marker})
 // Unknown retained payloads are erased too; fixture-only fields simulate older records.
 await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.legacyPayload',json(?)) WHERE kind='data-request' AND id=?").bind(JSON.stringify({nested:[marker]}),requests[2].id).run()
 const exportedRequest=await cmd('data-request',{candidate:c.candidate.id,type:'access',note:marker,channel:marker})
 requests.push(exportedRequest)
 const access=await h.send('/api/lodge/download/candidate/'+c.candidate.id+'?request='+exportedRequest.id,undefined,h.owner)
 assert.equal(access.status,200)
 const digest=(await h.state()).dataRequests.find(r=>r.id===exportedRequest.id).exportDigest
 assert.ok(digest)
 const mergedHold=await cmd('hold',{candidate:c.candidate.id,reason:marker})
 await cmd('release-hold',{id:mergedHold.id,reason:marker})
 const offer=await cmd('offer',{application:a.application.id,title:'Offer',salary:{currency:'USD',amount:100,period:'year'},startDate:'2026-12-20'})
 const approval=await cmd('request-offer-approval',{id:offer.id,approver:'owner@example.test'})
 await cmd('decide-approval',{id:approval.id,decision:'approved',version:approval.version,reason:marker})
 await cmd('offer-outcome',{id:offer.id,outcome:'declined',reason:marker})
 await cmd('release-feedback',{application:a.application.id,reason:marker})
 const draft=await cmd('vacancy',{title:'Unrelated draft',headcount:1,location:'Remote',manager:'morgan@example.test'})
 const note=await cmd('note',{application:a.application.id,text:marker},manager)
 const criterion=vacancy.rubrics[0].criteria[0].id
 const feedback=await cmd('propose',{workflow:'feedback-packet',summary:marker,sources:[{kind:'interview-note',id:note.id}],changes:[{op:'scorecard',input:{application:a.application.id,ratings:{[criterion]:3},evidence:{[criterion]:marker}}}],citations:[{criterion,note:note.id,quote:marker}]},manager)
 await cmd('decide-proposal',{id:feedback.id,decision:'approved',reason:'My evidence'},manager)
 const card=(await h.state(manager)).scorecards.find(r=>r.application===a.application.id)
 const doc=await cmd('document',{application:b.application.id,name:'private.txt',base64:Buffer.from(marker).toString('base64')})
 const interview=await cmd('interview',{application:c.application.id,planItem:vacancy.plan[0].id,participants:['ivy@example.test'],slots:['2026-12-12T15:00:00Z']})
 const packets=[feedback]
 const sourcePacket = (source) => ({workflow:'prepare-vacancy',summary:marker,approver:'owner@example.test',sources:[source],changes:[{op:'vacancy',input:{...draft,description:marker}}]})
 for (const [kind,id] of [['candidate',b.candidate.id],['candidate',c.candidate.id],['application',b.application.id],['document',doc.id],['interview',interview.id]]) {
  const packet=await cmd('propose',sourcePacket({kind,id}),manager)
  packets.push(packet)
  if (kind==='candidate'&&id===c.candidate.id) await cmd('decide-proposal',{id:packet.id,decision:'rejected',reason:'Do not change draft'})
 }
 packets.push(await cmd('propose',{workflow:'feedback-packet',summary:marker,sources:[{kind:'scorecard',id:card.id}],changes:[{op:'scorecard',input:{application:a.application.id,ratings:{},evidence:{}}}]},manager))
 // A proposal can read only a vacancy yet carry personal data in a typed input.
 const typed=await cmd('propose',{workflow:'coordination',summary:marker,approver:'morgan@example.test',sources:[{kind:'vacancy',id:vacancy.id}],changes:[{op:'message',input:{application:a.application.id,purpose:'other',subject:'Candidate follow-up',body:marker}}]})
 packets.push(typed)
 const unrelated=await cmd('propose',{workflow:'prepare-vacancy',summary:'Unrelated vacancy proposal',approver:'morgan@example.test',sources:[{kind:'vacancy',id:draft.id}],changes:[{op:'vacancy',input:{...draft,description:'Keep this unrelated work'}}]})
 const otherPerson=await add('Unrelated person')
 const otherPacket=await cmd('propose',{workflow:'prepare-vacancy',summary:'Keep unrelated person work',approver:'owner@example.test',sources:[{kind:'candidate',id:otherPerson.candidate.id}],changes:[{op:'vacancy',input:{...draft,description:'Unrelated candidate context'}}]},manager)
 const otherRequest=await cmd('data-request',{candidate:otherPerson.candidate.id,type:'correction',channel:'Keep this channel',note:'Keep this request'})
 const otherHold=await cmd('hold',{candidate:otherPerson.candidate.id,reason:'Keep this hold'})
 const otherVacancyHold=await cmd('hold',{vacancy:draft.id,reason:'Keep other vacancy history'})
 await cmd('release-hold',{id:otherVacancyHold.id,reason:'Keep this release'})
 // Include every unrelated row and the shared vacancy history, byte for byte.
 const unrelatedIds=new Set([unrelated.id,otherPacket.id,otherPerson.candidate.id,otherPerson.application.id,otherRequest.id,otherHold.id,otherVacancyHold.id,vacancy.id,draft.id])
 const preserve = r => unrelatedIds.has(r.id) || r.kind==='audit' && unrelatedIds.has(JSON.parse(r.value).record?.split(':').slice(1).join(':'))
 const unrelatedRows=(await recordSnapshot(h)).filter(preserve)
 const erase={candidate:a.candidate.id,confirm:a.candidate.name,reason:marker}
 const refused = async () => {
  const before=await recordSnapshot(h),transfers=await transferSnapshot(h)
  assert.equal((await h.send('/api/lodge/delete-candidate',erase,h.owner)).status,409)
  assert.deepEqual(await recordSnapshot(h),before,'a held or active candidate loses no data')
  assert.deepEqual(await transferSnapshot(h),transfers,'refused deletion changes no portability state or stored transfer data')
 }
 await refused()
 // Real Base transfers keep both finished and unfinished snapshots, plus archive
 // bytes and import staging. Leave all three unaborted until HTTP erasure.
 const portability=await createPortability({db:h.db,policy})
 const archive = async () => {
  const id=await portability.exports.create()
  while ((await portability.exports.advance(id,{maxParts:16})).phase==='building') {}
  const records=[]
  for await (const record of readArchive(await portability.exports.download(id))) records.push(record)
  return {id,records}
 }
 const completed=await archive(),building=await portability.exports.create()
 const partial=await portability.exports.advance(building,{maxParts:1})
 assert.equal(partial.phase,'building')
 assert.ok(partial.completed>0,'the unfinished export has stored archive parts')
 const staged=await portability.imports.create(completed.records[0])
 for (const part of completed.records.filter(r=>r.kind==='part')) await portability.imports.uploadPart(staged,part.index,part)
 assert.equal((await portability.exports.status(building)).phase,'building')
 assert.equal((await portability.imports.status(staged)).phase,'staging')
 for (const id of [completed.id,building,staged]) {
  const job=await h.db.prepare('SELECT metadata FROM rer_portability_jobs WHERE id=?').bind(id).first()
  const copy=JSON.parse(job.metadata).copies.l_records
  const retained=await h.db.prepare('SELECT value FROM "'+copy.replaceAll('"','""')+'" WHERE kind=\'candidate\' AND id=?').bind(a.candidate.id).first()
  assert.ok(retained.value.includes(marker),'the real transfer holds the person before deletion')
 }
 assert.ok((await h.db.prepare('SELECT data FROM rer_portability_segments').all()).results.some(row=>row.data.includes(marker)),'completed/staged archive parts hold personal bytes before deletion')
 for(const added of [a,b,c]) await cmd('move',{application:added.application.id,to:'withdrawn',reason:marker})
 await cmd('review-duplicate',{keep:b.candidate.id,other:c.candidate.id,decision:'merge',reason:marker})
 await cmd('review-duplicate',{keep:a.candidate.id,other:b.candidate.id,decision:'merge',reason:marker})
 const exported=await h.send('/api/lodge/download/candidate/'+a.candidate.id,undefined,h.owner)
 assert.deepEqual(exported.value.mergedCandidates.map(c=>c.id).sort(),[b.candidate.id,c.candidate.id].sort(),'access export includes the complete merged lineage')
 const hold=await cmd('hold',{candidate:a.candidate.id,reason:marker})
 await refused()
 await cmd('release-hold',{id:hold.id,reason:marker})
 await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.imported',json(?)) WHERE kind='candidate' AND id=?").bind(JSON.stringify({job:'original-custody'}),a.candidate.id).run()
 await refused()
 await h.db.prepare("UPDATE l_records SET value=json_remove(value,'$.imported') WHERE kind='candidate' AND id=?").bind(a.candidate.id).run()
 const tx=await transactions(h)
 try {
  const beforePrepare=await transferSnapshot(h)
  const pendingExport=await tx.prepare('delete-candidate',erase)
  assert.deepEqual(await transferSnapshot(h),beforePrepare,'preparing erasure performs no portability writes')
  const lateExport=await portability.exports.create()
  await tx.refuse(pendingExport)
  const pending=await tx.prepare('delete-candidate',erase)
  // A new proposal arriving after preparation must not survive a stale erasure.
  const late=await cmd('propose',sourcePacket({kind:'candidate',id:a.candidate.id}),manager)
  packets.push(late)
  await tx.refuse(pending)
  const pendingHold=await tx.prepare('delete-candidate',erase)
  const lateHold=await cmd('hold',{vacancy:vacancy.id,reason:'New vacancy hold'})
  await tx.refuse(pendingHold)
  await cmd('release-hold',{id:lateHold.id,reason:'Finished'})
  const sharedHold=await cmd('hold',{vacancy:vacancy.id,reason:marker})
  await cmd('release-hold',{id:sharedHold.id,reason:marker})
  await h.db.prepare("UPDATE l_records SET value=json_set(value,'$.legacyDetail',?) WHERE kind='audit' AND json_extract(value,'$.record')=?").bind(marker,'hold:'+sharedHold.id).run()
  const pendingRequest=await tx.prepare('complete-data-request',{id:requests[0].id,outcome:marker})
  const pendingErasure=await tx.prepare('delete-candidate',erase)
  const lateRequest=await cmd('data-request',{candidate:a.candidate.id,type:'correction',note:marker,channel:marker})
  requests.push(lateRequest)
  await tx.refuse(pendingErasure)
  const pendingProposal=await tx.prepare('propose',sourcePacket({kind:'candidate',id:a.candidate.id}),'morgan@example.test')
  const result=await h.send('/api/lodge/delete-candidate',erase,h.owner)
  assert.equal(result.status,200,JSON.stringify(result.value))
  assert.equal(result.value.counts.proposal,packets.length,'receipt counts every erased proposal, including hidden and decided ones')
  assert.equal(result.value.counts.candidate,2,'nested merged candidates are erased')
  assert.equal(result.value.counts['data-request'],requests.length)
  assert.equal(result.value.counts.hold,2)
  assert.ok(!JSON.stringify(result.value).includes(marker),'the typed deletion reason is not retained')
  const transfers=await transferSnapshot(h)
  assert.ok(!transfers.some(table=>/^rer_portability_(snap|stage)_/.test(table.name)),'all snapshot and staging tables, including sidecars, are dropped')
  for (const table of ['rer_portability_jobs','rer_portability_parts','rer_portability_segments','rer_portability_owned']) assert.deepEqual(transfers.find(t=>t.name===table).rows,[],table+' is empty after erasure')
  assert.ok(!JSON.stringify(transfers).includes(marker),'no retained transfer bytes or metadata contain erased text')
  for (const id of [completed.id,building,lateExport]) await assert.rejects(()=>portability.exports.download(id),error=>error.code==='job_not_found'&&error.status===404,'invalidated export cannot download')
  await assert.rejects(()=>portability.imports.status(staged),error=>error.code==='job_not_found'&&error.status===404,'invalidated import cannot resume')
  const rows=await recordSnapshot(h)
  assert.ok(!rows.some(r=>r.kind==='proposal'&&packets.some(p=>p.id===r.id)),'whole raw proposal rows are removed')
  assert.ok(!rows.some(r=>r.value.includes(marker)),'no stored personal text, audit copy, request payload, or bytes remain')
  for (const {candidate} of [a,b,c]) for (const personal of [candidate.name,candidate.email]) assert.ok(!rows.some(r=>r.value.includes(personal)),'names and contact details are erased')
  assert.ok(!rows.some(r=>r.value.includes(digest)),'export digests are erased from requests and audit copies')
  assert.ok(!JSON.stringify(await h.state()).includes(marker),'the authorized HTTP projection contains no erased text')
  assert.ok(!rows.some(r=>r.kind==='data-request'&&requests.some(request=>request.id===r.id)))
  const shared=JSON.parse(rows.find(r=>r.kind==='hold'&&r.id===sharedHold.id).value)
  assert.equal(shared.vacancy,vacancy.id)
  assert.equal(shared.status,'released')
  assert.equal(shared.reason,undefined)
  assert.equal(shared.releaseReason,undefined)
  assert.ok(!rows.some(r=>r.kind==='candidate'&&[b.candidate.id,c.candidate.id].includes(r.id)))
  assert.ok(!rows.some(r=>r.kind==='blob'&&r.id===doc.id))
  assert.deepEqual(rows.filter(preserve),unrelatedRows)
  await tx.refuse(pendingProposal)
  await tx.refuse(pendingRequest)
  const beforeCompletion=await recordSnapshot(h)
  for (const request of requests) assert.equal((await h.send('/api/lodge/command/complete-data-request',{id:request.id,outcome:marker},h.owner)).status,404)
  assert.deepEqual(await recordSnapshot(h),beforeCompletion,'old request completion cannot reintroduce erased text')
  const fresh=await archive()
  try {
   assert.ok(!JSON.stringify(fresh.records).includes(marker),'future installation exports contain no erased text')
   assert.ok(fresh.records[0].epoch>completed.records[0].epoch,'new exports carry the erasure epoch')
   const items=fresh.records.filter(r=>r.kind==='part').flatMap(part=>part.items)
   const tombstone=items.find(item=>item.kind==='row'&&item.table==='l_records'&&item.row.kind==='candidate'&&item.row.id===a.candidate.id)
   assert.equal(JSON.parse(tombstone.row.value).deleted,true,'the primary candidate tombstone keeps its key in future archives')
   const exportedRows=items.filter(item=>item.kind==='row'&&item.table==='l_records').map(item=>item.row)
   assert.deepEqual(unrelatedRows.map(row=>exportedRows.find(item=>item.kind===row.kind&&item.id===row.id)),unrelatedRows,'future archives preserve unrelated durable records exactly')
  } finally {await portability.exports.abort(fresh.id)}
 } finally {await tx.close()}
}
