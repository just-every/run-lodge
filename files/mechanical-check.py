import hashlib,json,subprocess
from pathlib import Path
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
commands=[
['node','scripts/contract-docs.mjs','write','BASE-AGENT-001'],
['node','scripts/contract-docs.mjs','check','BASE-AGENT-001'],
['git','checkout','origin/main','--','ACCEPTANCE.md','docs/CLAIMS.md'],
['node','scripts/edition-authoring/cli.mjs','lock'],
['node','scripts/edition-authoring/cli.mjs','check'],
['git','diff','--exit-code'],
['git','diff','--check'],
]
rows=[]
for command in commands:
 r=subprocess.run(command,capture_output=True)
 row=dict(command=' '.join(command),exit=r.returncode,stdoutSha256=hashlib.sha256(r.stdout).hexdigest(),stderrSha256=hashlib.sha256(r.stderr).hexdigest())
 rows.append(row)
 print(row['command']+' exit='+str(row['exit']))
 if r.returncode: break
receipt=dict(head=head,commands=rows,ledger=dict(command='none',exit=0,reason='No migration changed'),generatedViewsRestored=True)
Path('../packet/mechanical-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
if any(r['exit'] for r in rows): raise SystemExit(1)
