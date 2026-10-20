import { fileURLToPath as __rerTestEntryPath } from 'node:url';
const __rerTestEntry = __rerTestEntryPath(import.meta.resolve('@runeditrun/rer/internal/global/rer.mjs'));
const __rerTestEntryArgs = args => args[1] === 'dev' && !args.some(arg => ['--foreground', '--detach', '--stop', '--help'].includes(arg)) ? [...args, '--foreground'] : args;
// Fresh checkouts and the public rer commands, as an owner would run them.
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const source = resolve(new URL('..', import.meta.url).pathname)
const run = promisify(execFile)

/** A plain local clone of the committed HEAD: no inherited dependencies, settings or data. */
export async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'lodge-clone-'))
  await run('git', ['clone', '--no-hardlinks', '--quiet', source, root])
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: root })
  return { root, head: stdout.trim() }
}

export async function freePort() {
  const s = createServer()
  await new Promise(r => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise(r => s.close(r))
  return port
}

// Never print sign-in URLs or tokens into logs.
const clean = text => text.replace(/^RER_OPEN .*$/gm, 'RER_OPEN [private sign-in URL omitted]').replace(/([?&#]token=)[^\s&]+/g, '$1[redacted]').replace(/(rer-dev=)[^\s&]+/g, '$1[redacted]')

export async function command(root, args, { expected = 0 } = {}) {
  const child = spawn(process.execPath, __rerTestEntryArgs([__rerTestEntry, ...args]), { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', RER_SERVER_JOURNEY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { log += c })
  const code = await new Promise((ok, fail) => { child.once('error', fail); child.once('close', ok) })
  if (code !== expected) throw new Error(`rer ${args.join(' ')} exited ${code}, expected ${expected}:\n${clean(log).slice(-6000)}`)
  console.log(`rer ${args.join(' ')}: exit ${code}`)
  return clean(log)
}

export async function start(root, port, mode = 'dev') {
  const child = spawn(process.execPath, __rerTestEntryArgs([__rerTestEntry, mode, '--port', String(port)]), { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', RER_SERVER_JOURNEY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', c => { output += c })
  const deadline = Date.now() + 15 * 60 * 1000
  while (!output.includes('RER_READY') && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${mode} exited: ${clean(output).slice(-4000)}`)
    await new Promise(r => setTimeout(r, 250))
  }
  const close = async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)) }
  }
  if (!output.includes('RER_READY')) { await close(); throw new Error(mode + ' did not become ready') }
  return { origin: `http://127.0.0.1:${port}`, close }
}

export async function report(dir, value) {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'result.json'), JSON.stringify(value, null, 2) + '\n')
}
