// Installed-emulator proof. Only synthetic sessions are passed to this app's own test process.
// The relay drives real Worker routes; it can disconnect the network edge after committing a request.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { hiringScenario, RUBRIC } from './hiring-fixture.mjs'
import { join } from 'node:path'

const sdk = process.env.ANDROID_HOME
assert.ok(sdk, 'Set ANDROID_HOME to an installed SDK with a running emulator')
const adb = join(sdk, 'platform-tools', 'adb')
async function command(bin, args, collect = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: collect ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
    let text = ''
    child.stdout?.on('data', b => { text += b })
    child.on('error', reject)
    child.on('exit', code => code ? reject(Error([bin, ...args].join(' ') + ' exited ' + code)) : resolve(text))
  })
}
async function capture(path) {
  await command(adb, ['shell', 'screencap', '-p', '/data/local/tmp/lodge-proof.png'])
  await command(adb, ['pull', '/data/local/tmp/lodge-proof.png', path])
  const { readFile } = await import('node:fs/promises')
  const bytes = await readFile(path)
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', 'the host must capture a real device image')
}

const evidence = process.env.LODGE_EVIDENCE
const cleanups = []
const f = await hiringScenario({ after: fn => cleanups.push(fn) })
const address = name => name + String.fromCharCode(64) + 'example.test'
let online = true, lose = false, sequence = 30, current
const job = await f.openJob('synthetic-lodge-native')
async function assignment() {
  const { application } = await f.cmd('candidate', { name: 'synthetic-lodge-native candidate', email: address('synthetic-lodge-' + sequence++), source: 'Referral', consentBasis: 'referral', vacancy: job.id }, f.manager)
  const iv = await f.cmd('interview', { application: application.id, planItem: job.plan[0].id, participants: [address('ivy')], slots: ['2027-01-04T15:00:00.000Z'] }, f.manager)
  await f.cmd('schedule', { interview: iv.id, slot: 0 }, f.manager)
  current = { application, iv }
}
await assignment()
const server = createServer(async (req, res) => {
  try {
    const path = req.url
    let value
    if (path === '/fixture') value = { origin, cookie: f.ivy }
    else if (/^\/proof-(offline|conflict|uncertain|confirmed|revoked)$/.test(path)) {
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        for (const width of [1440, 390]) {
          await command(adb, ['shell', 'wm', 'size', width + 'x1000'])
          await new Promise(resolve => setTimeout(resolve, 2000))
          await capture(join(evidence, path.slice(1) + '-' + width + '.png'))
        }
        await command(adb, ['shell', 'wm', 'size', '390x844'])
      }
      value = {}
    }
    else if (path === '/offline') { online = false; value = {} }
    else if (path === '/online') { online = true; value = {} }
    else if (path === '/rubric') {
      await f.cmd('unpublish', { id: job.id, reason: 'Review native rubric' }, f.manager)
      await f.cmd('rubric', { id: job.id, criteria: RUBRIC }, f.manager)
      value = {}
    } else if (path === '/lose-confirmation') { lose = true; value = {} }
    else if (path === '/allow-confirmation') { lose = false; value = {} }
    else if (path === '/next') {
      await f.cmd('cancel-interview', { interview: current.iv.id, reason: 'Next native assignment' }, f.manager)
      // A new approved publication permits a distinct application's intake.
      await f.approve((await f.cmd('request-vacancy-approval', { id: job.id, approver: address('parker') }, f.manager)).id)
      await f.cmd('publish', { id: job.id }, f.manager)
      await assignment(); value = {}
    } else if (path === '/role' || path === '/restore-role') {
      await f.cmd('member', { email: address('ivy'), name: 'Ivy Chen', roles: path === '/role' ? ['employee'] : ['interviewer'] }); value = {}
    } else if (path === '/revoke') {
      await f.h.db.prepare('UPDATE oa_sessions SET revoked_at=1 WHERE operator_id IN (SELECT id FROM oa_operators WHERE email=?)').bind(address('ivy')).run(); value = {}
    } else if (path === '/stats') {
      const rows = (await f.h.db.prepare("SELECT kind,value FROM l_records WHERE kind IN ('scorecard','audit')").all()).results
      value = { submitted: rows.filter(r => r.kind === 'scorecard' && JSON.parse(r.value).status === 'submitted').length, audits: rows.filter(r => r.kind === 'audit' && JSON.parse(r.value).action === 'scorecard-submitted').length }
    } else if ((path.startsWith('/api/lodge/') || path === '/auth/signout')) {
      if (!online) { req.socket.destroy(); return }
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined
      const result = await f.send(path, body, req.headers.cookie ?? '')
      if (lose && path === '/api/lodge/command/scorecard' && result.status === 200) { req.socket.destroy(); return }
      res.writeHead(result.status, { 'content-type': ['application', 'json'].join('/') }); res.end(result.text); return
    } else { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': ['application', 'json'].join('/') }); res.end(JSON.stringify(value))
  } catch (error) { console.error(error.message); res.writeHead(500); res.end(JSON.stringify({ error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port, origin = 'http://127.0.0.1:' + port
try {
  await command(adb, ['reverse', 'tcp:' + port, 'tcp:' + port])
  await command(adb, ['install', '-r', 'native/android/app/build/outputs/apk/debug/app-debug.apk'])
  await command(adb, ['install', '-r', 'native/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'])
  await command(adb, ['shell', 'pm', 'clear', 'com.runeditrun.lodge'])
  await command(adb, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
  await command(adb, ['shell', 'wm', 'dismiss-keyguard'])
  await command(adb, ['shell', 'svc', 'power', 'stayon', 'true'])
  await command(adb, ['shell', 'wm', 'density', '160'])
  await command(adb, ['shell', 'wm', 'size', '390x844'])
  const receipt = []
  for (const test of ['testDraftOffline', 'testRestartAndReconnect', 'testReconcileAndRevocation']) {
    const output = await command(adb, ['shell', 'am', 'instrument', '-w', '-r', '-e', 'fixture', origin, '-e', 'class', 'com.runeditrun.lodge.OfflineJourney#' + test, 'com.runeditrun.lodge.test/com.runeditrun.lodge.JourneyRunner'], true)
    console.log(output)
    assert.match(output, /OK \(1 test\)/, test + ' must pass on the installed native app')
    receipt.push({ test, passed: true })
    // This terminates the actual app process; the next phase must reopen durable storage.
    await command(adb, ['shell', 'am', 'force-stop', 'com.runeditrun.lodge'])
    await f.h.restart()
  }
  if (evidence) await writeFile(join(evidence, 'native-result.json'), JSON.stringify({ head: (await command('git', ['rev-parse', 'HEAD'], true)).trim(), receipt }, null, 2))
} finally {
  await command(adb, ['shell', 'wm', 'size', 'reset'])
  await command(adb, ['shell', 'wm', 'density', 'reset'])
  await command(adb, ['reverse', '--remove', 'tcp:' + port])
  await new Promise(resolve => server.close(resolve))
  for (const cleanup of cleanups) await cleanup()
}
