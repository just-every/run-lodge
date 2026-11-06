"""Recreate the disposable built-Worker harness without changing tracked source."""
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
source = (root / 'tests/harness.mjs').read_text()
source = source.replace("const bundle = await workerBundle(liveMail, devIdentity)", "")
source = source.replace(
    "modules: true, script: bundle.outputFiles[0].text",
    "modules: [{type: 'ESModule', path: join(process.cwd(), 'dist/server/index.js')}, ...(await readdir('dist/server/assets')).filter(f=>f.endsWith('.js')).map(f=>({type: 'ESModule', path: join(process.cwd(), 'dist/server/assets', f)}))], modulesRoot: join(process.cwd(), 'dist/server')",
)
source = source.replace(
    "if (options.devIdentity !== undefined) workerOptions.script = (await workerBundle(liveMail, options.devIdentity)).outputFiles[0].text",
    "if (options.devIdentity !== undefined) throw Error('This one-off production driver keeps its entry unchanged')",
)
source = source.replace("host: '127.0.0.1', port,", "host: '127.0.0.1', port, unsafeRegisterWorker: false,")
target = root / 'tests/.sx-lodge-c-f54-harness.mjs'
target.write_text(source)
print('Disposable harness prepared from existing native fixture helpers and built production modules')
