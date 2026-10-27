// Incremental contract generation preserves legacy acceptance prose for clauses outside this round.
import { readFile, writeFile } from 'node:fs/promises'
import { parseContract } from '../src/base/seed-contract.mjs'

const mode = process.argv[2]
if (!['write', 'check'].includes(mode)) throw new Error('Use write or check, followed by clause IDs')
const selected = new Set(process.argv.slice(3))
if (!selected.size) throw new Error('Name the clauses whose acceptance rows should be regenerated')
let source = await readFile('CONTRACT.md', 'utf8')
const rows = source.split('\n').flatMap(line => {
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim())
  if (cells.length !== 6 || !/^[A-Z][A-Z0-9-]*-\d+$/.test(cells[0].replace(/`/g, ''))) return []
  return [[line, cells[0].replace(/`/g, ''), ...cells.slice(1)]]
})
for (const [label, kinds] of [['Published', ['published']], ['Target and push further', ['target', 'push-further']], ['All', ['published', 'target', 'push-further']]]) {
  const group = rows.filter(row => kinds.includes(row[3]))
  const tally = ['done', 'partial', 'missing'].map(status => group.filter(row => row[4] === status).length)
  source = source.replace(new RegExp('^\\| ' + label + ' \\|.*$', 'm'), '| ' + label + ' | ' + [...tally, group.length].join(' | ') + ' |')
}
const contract = parseContract(source)
for (const id of selected) if (!contract.clauses.some(c => c.id === id)) throw new Error('Unknown clause: ' + id)
const escape = value => value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
let acceptance = await readFile('ACCEPTANCE.md', 'utf8')
for (const clause of contract.clauses.filter(c => selected.has(c.id))) {
  const row = rows.find(row => row[1] === clause.id)
  const journey = clause.text.split('**Acceptance evidence:**')[1]?.trim() ?? clause.text
  const proof = [row[5], 'Required journey: ' + journey, clause.gap ? 'Remaining: ' + clause.gap : ''].filter(Boolean).join(' ')
  const line = '| ' + [clause.id, clause.title + '.', proof, clause.status].map(escape).join(' | ') + ' |'
  const match = new RegExp('^\\| ' + clause.id + ' \\|.*$', 'm')
  if (!match.test(acceptance)) throw new Error('Missing acceptance row: ' + clause.id)
  acceptance = acceptance.replace(match, () => line)
}
let claims = '# Lodge implementation claims\n\nGenerated from CONTRACT.md by the seed contract documentation command. The contract retains every acceptance requirement and evidence gap.\n\n'
claims += '| Clause | Title | Status |\n| --- | --- | --- |\n'
for (const row of rows) claims += '| ' + [row[1], row[2], row[4]].map(escape).join(' | ') + ' |\n'
for (const [path, output] of [['CONTRACT.md', source], ['ACCEPTANCE.md', acceptance], ['docs/CLAIMS.md', claims]]) {
  const original = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  if (mode === 'write') { if (original !== output) await writeFile(path, output) }
  else if (original !== output) throw new Error(path + ' needs contract documentation regeneration')
}
console.log('Contract documentation ' + mode + ' passed; ' + JSON.stringify(contract.counts))
