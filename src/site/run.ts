import type { RunData } from '../base/run-site'

/** Every string and command on the run site's Run page (/run), Base's standard two-step page. */
export const run: RunData = {
  name: 'Lodge',
  repository: 'https://github.com/just-every/run-lodge',
  clone: 'npx -y @runeditrun/rer dev just-every/run-lodge',
  folder: 'run-lodge',
  requirements: 'Runs on macOS, Linux or Windows with WSL2, with git. The installer brings Node when it is missing, and rer brings pnpm.',
  licence: 'MIT',
  docs: true,
  hosted: [],
}
