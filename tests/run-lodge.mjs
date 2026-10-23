// Local verification runs every area. CI's four matrix jobs use the same list,
// each with its own Worker/D1 and the complete rer verify build/runtime checks.
import { spawnSync } from 'node:child_process'

const areas = {
  candidates: ['hiring-candidates', 'agents'],
  offers: ['hiring-offers'],
  security: ['hiring-security', 'security'],
  reports: ['hiring-reports', 'move-in', 'portability'],
}
const selected = process.env.LODGE_TEST_AREA
if (selected && !Object.hasOwn(areas, selected)) throw new Error('Unknown LODGE_TEST_AREA: ' + selected)
const files = (selected ? areas[selected] : Object.values(areas).flat()).map(name => `tests/${name}.test.mjs`)
const child = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' })
if (child.error) throw child.error
process.exit(child.status ?? 1)
