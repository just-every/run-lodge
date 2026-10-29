import { lodgeTeam } from './team.ts'
import { createAgentDoor } from '../../modules/agent-door/index.ts'
import { createBusinessSettings } from '../../modules/business-settings/index.ts'
import { runtimeBindings, type Bindings } from '../../auth.server.ts'
import { capabilities, lodgeTools, notTools } from './tools.ts'
import { lodgePeople } from './people.ts'

/** One production door, using the installation's existing signed claim ring. */
export async function agentResponse(request: Request, original: Bindings): Promise<Response | null> {
  const path=new URL(request.url).pathname
  if (!/^\/(?:mcp(?:\/|$)|agents(?:\/|$)|api\/rer\/|\.well-known\/|rer-business)/.test(path)) return null
  const env=runtimeBindings(original)
  const trust=env.RER_OWNER_CLAIM_PUBLIC_KEYS?{issuer:env.RER_OWNER_CLAIM_ISSUER??'',installationId:env.RER_OWNER_CLAIM_INSTALLATION_ID??'',appOrigin:env.AUTH_ORIGIN,publicKeys:JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS)}:null
  const settings=createBusinessSettings({db:env.DB,business:{settings:1,values:['display_name'],team:{roles:{admin:'admin',member:'member'}}},team:lodgeTeam(env),trust:trust?{v:1,issuer:trust.issuer,audience:trust.appOrigin,subject:trust.installationId,email:env.OWNER_EMAIL,keys:trust.publicKeys}:null})
  const business=await settings.handle(request)
  if(business)return business
  return createAgentDoor({seed:'lodge',name:'Lodge',specialist:'Recruiting coordinator',db:env.DB,origin:env.AUTH_ORIGIN,trust,capabilities,
    people:lodgePeople(env),tools:lodgeTools(env),notTools,
  }).handle(request)
}
