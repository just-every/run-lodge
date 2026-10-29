import {randomUUID} from 'node:crypto'
export default async function ({request,origin,email,cookie}) {
  const command=async(op,body)=>{
    const response=await request(origin+'/api/lodge/command/'+op,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)})
    if(!response.ok) throw Error('Native fixture command refused: '+op)
    return response.json()
  }
  const state=async()=>{const response=await request(origin+'/api/lodge/state',{headers:{Cookie:cookie}});if(!response.ok)throw Error('Native fixture state refused');return response.json()}
  const job=await command('vacancy',{title:'Estimator '+randomUUID().slice(0,8),location:'Brooklyn, NY',manager:email,headcount:1,description:'Prepare estimates from drawings.',compensation:{currency:'USD',min:7000000,max:8500000,period:'year'}})
  await command('rubric',{id:job.id,criteria:[{name:'Takeoffs',description:'Explains a takeoff they prepared'}]})
  await command('interview-plan',{id:job.id,plan:[{name:'Bid review',stageName:'Interview',durationMinutes:60}]})
  await command('request-vacancy-approval',{id:job.id,approver:email})
  const approval=(await state()).approvals.find(a=>a.subjectId===job.id&&a.status==='pending')
  await command('decide-approval',{id:approval.id,decision:'approved',reason:'Synthetic budget approved by the owner',version:approval.currentVersion})
  await command('publish',{id:job.id})
  const {application}=await command('candidate',{name:'Riley Park',email:'riley-'+randomUUID()+'@example.invalid',source:'Synthetic referral',consentBasis:'referral',vacancy:job.id})
  await command('release-feedback',{application:application.id,reason:'No interviews yet; explicitly record the evidence gap'})
  const current=(await state()).vacancies.find(v=>v.id===job.id)
  return {values:{job:{id:job.id},debrief:{application:application.id,statements:[{kind:'gap',criterion:current.rubrics.at(-1).criteria[0].id,text:'Takeoffs has not been assessed.'}]}}}
}
