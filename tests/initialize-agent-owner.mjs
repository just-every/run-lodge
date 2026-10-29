// Disposable tooling drives only the production owner and first-run doors.
export default async function ({request, origin, claim, displayName, email, returnTo}) {
  const response=await request(origin+claim.path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:claim.token,displayName,returnTo})})
  if(response.status!==303) return response
  const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')
  const command=await request(origin+'/api/lodge/command/business',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Northstar Hiring',accommodationContact:email,retentionDays:365,jurisdiction:'US',privacyNotice:'Synthetic applicant records are retained for this disposable verification only.',timeZone:'America/New_York'})})
  if(!command.ok) throw Error('Native business setup refused')
  await command.body.cancel()
  const setup=await request(origin+'/setup',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({confirm:'yes',displayName})})
  if(setup.status!==303) throw Error('Native first-run setup refused')
  await setup.body?.cancel()
  return response
}
