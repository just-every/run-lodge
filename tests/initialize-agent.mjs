import {createHash} from 'node:crypto'
export default async function ({agentId,request,origin,email}) {
  const address='door-'+createHash('sha256').update(agentId).digest('hex').slice(0,24)+'@agents.example.invalid'
  const response=await request(origin+'/api/lodge/command/member',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:address,name:'Recruiting coordinator',agent:true,actsFor:email,businessAgentId:agentId})})
  if(!response.ok) throw Error('Native agent binding refused')
  await response.body.cancel()
}
