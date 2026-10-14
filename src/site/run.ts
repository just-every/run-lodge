import type { RunData } from '../base/run-site'

/** Every string and command on the run site's Run page (/run). */
export const run: RunData = {
  name: 'Lodge',
  repository: 'https://github.com/just-every/run-lodge',
  clone: 'git clone https://github.com/just-every/run-lodge.git lodge',
  folder: 'lodge',
  requirements: 'Needs Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2.',
  licence: 'MIT',
  docs: true,
  hosted: [],
}
