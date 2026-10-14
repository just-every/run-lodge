import { fileURLToPath as __rerTestEntryPath } from 'node:url';
const __rerTestEntry = __rerTestEntryPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'));
const __rerTestEntryArgs = args => args[1] === 'dev' && !args.some(arg => ['--foreground', '--detach', '--stop', '--help'].includes(arg)) ? [...args, '--foreground'] : args;
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, copyFile, cp, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { getPlatformProxy } from 'wrangler'

/** Exercise the public rer command, including its installer adapter and staged child. */
export async function checkCliPolicy(valid, invalid, documentId) {
 const root = await mkdtemp(join(tmpdir(), 'lodge-cli-policy-')), children = new Set()
 const restore = async input => {
  const env = {...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH,WRANGLER_SEND_METRICS:'false'}
  // This checkout owns its operation; retain the parent's shared job admission.
  delete env.RER_LOCAL_OPERATION
  const child = spawn(process.execPath, __rerTestEntryArgs([__rerTestEntry,'import','--input',input,'--yes','--non-interactive','--json']), {
   cwd:root, env, stdio:['ignore','pipe','pipe'],
  })
  children.add(child)
  let output=''
  child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
  const code=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject)})
  children.delete(child)
  return {code,output}
 }
 try {
  // CLI containment checks require real source directories, not a symlinked adapter.
  for (const name of ['scripts','src','migrations']) await cp(resolve(name),join(root,name),{recursive:true})
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir')
  for (const name of ['package.json','wrangler.jsonc','OPERATIONS.json','RUN-LOCALLY.md','ACCEPTANCE.md','rer-setup.json','.node-version']) await copyFile(resolve(name),join(root,name))
  const bytes = archive => [archive.manifest, archive.part, archive.closing].map(r => JSON.stringify(r)).join('\n') + '\n'
  await writeFile(join(root,'valid.rer'),bytes(valid),{mode:0o600})
  async function inspect(check) {
   const proxy = await getPlatformProxy({ configPath: join(root, 'wrangler.jsonc'), persist: { path: join(root, '.wrangler/state/v3') }, remoteBindings: false })
   try { await check(proxy.env.DB) } finally { await proxy.dispose() }
  }
  for (const [name,archive] of invalid) {
   await writeFile(join(root,'invalid.rer'),bytes(archive),{mode:0o600})
   const result=await restore('invalid.rer')
   assert.notEqual(result.code,0,name)
   assert.match(result.output,/lodge_staged_validation/,name+': '+result.output)
   await inspect(async db => {
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM l_records').first()).n,0,name)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM ik_jobs').first()).n,0,name)
   })
  }
  const result=await restore('valid.rer')
  assert.equal(result.code,0,result.output)
  await inspect(async db => {
   const row = await db.prepare("SELECT value FROM l_records WHERE kind='blob' AND id=?").bind(documentId).first()
   assert.equal(Buffer.from(JSON.parse(row.value).base64, 'base64').toString(), 'ORIGINAL-ARCHIVE-DOCUMENT')
  })
 } finally {
  for (const child of children) if(child.exitCode===null&&child.signalCode===null) {
   child.kill('SIGTERM');await new Promise(resolve=>child.once('close',resolve))
  }
  await rm(root, { recursive: true, force: true })
 }
}
