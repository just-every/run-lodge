// Incrementally regenerate selected legacy acceptance rows from CONTRACT.md.
// Existing policy quotations and required journeys stay intact.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseContract } from '../src/base/seed-contract.mjs'

const [mode, ...ids] = process.argv.slice(2)
if (!['write', 'check'].includes(mode) || !ids.length) throw Error('Usage: node scripts/contract-docs.mjs write|check CLAUSE [CLAUSE ...]')
// Summary cells are generated from the complete source register before parsing it.
let source = readFileSync('CONTRACT.md', 'utf8')
const rows = source.split('\n').filter(line => /^\| `?[A-Z][A-Z0-9-]*-[0-9]+`? \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()))
source = source.replace(/^\| (Published|Target and push further|All) \|.*$/gm, (_, label) => {
  const selected = rows.filter(row => label === 'All' || (label === 'Published' ? row[2] === 'published' : ['target', 'push-further'].includes(row[2])))
  return '| ' + label + ' | ' + ['done', 'partial', 'missing'].map(status => selected.filter(row => row[3] === status).length).join(' | ') + ' | ' + selected.length + ' |'
})
const lines = source.split('\n')
const contract = parseContract(source)
let acceptance = readFileSync('ACCEPTANCE.md', 'utf8')
let claims
try { claims = readFileSync('docs/CLAIMS.md', 'utf8') } catch { claims = '# Lodge implementation claims\n\nSelected rows generated from CONTRACT.md. The complete status register remains in CONTRACT.md.\n\n| Clause | Status | Evidence | Gap |\n| --- | --- | --- | --- |\n' }
for (const id of ids) {
  const clause = contract.clauses.find(c => c.id === id)
  if (!clause) throw Error('Unknown clause: ' + id)
  const cells = lines[clause.row - 1].split('|').slice(1, -1).map(x => x.trim())
  if (cells.length !== 6) throw Error('Expected six source status cells: ' + id)
  const [,, , status, evidence, gap] = cells
  const pattern = new RegExp('^\\| ' + id + ' \\|.*$', 'm')
  const old = acceptance.match(pattern)?.[0]
  if (!old) throw Error('Missing acceptance row: ' + id)
  const oldCells = old.split('|').slice(1, -1).map(x => x.trim())
  const legacyJourney = oldCells[2].startsWith('Required journey:') ? oldCells[2].split('`')[0].trim() + ' ' : ''
  const sourceJourney = clause.text.split('**Acceptance evidence:**')[1]?.trim()
  const nativePolicy = clause.text.match(/Native phone-reference default ADOPTED WITH RIDERS[\s\S]*?(?= \*\*Acceptance evidence:)/)?.[0]
  const journey = id === 'HIRE-008' && sourceJourney ? `Required journey: ${sourceJourney} ${nativePolicy ? nativePolicy + ' ' : ''}` : legacyJourney
  const row = `| ${id} | ${oldCells[1]} | ${journey}${evidence}${gap ? ' Remaining: ' + gap : ''} | ${status} |`
  acceptance = acceptance.replace(pattern, row)
  const claim = `| ${id} | ${status} | ${evidence} | ${gap} |`
  claims = pattern.test(claims) ? claims.replace(pattern, claim) : claims.trimEnd() + '\n' + claim + '\n'
}
for (const [path, generated] of [['CONTRACT.md', source], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]) {
  if (mode === 'write') writeFileSync(path, generated)
  else if (readFileSync(path, 'utf8') !== generated) throw Error('Stale generated contract record: ' + path)
}
console.log('contract-docs ' + mode + ': ' + ids.join(', ') + '; counts ' + JSON.stringify(contract.counts))
