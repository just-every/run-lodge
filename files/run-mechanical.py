from pathlib import Path
import subprocess, json, datetime, sys
root=Path(sys.argv[1]).resolve()
packet=Path(__file__).resolve().parent
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
commands=[
 ('views-write',['node','scripts/contract-docs.mjs','write','BASE-AGENT-012']),
 ('views-check',['node','scripts/contract-docs.mjs','check','BASE-AGENT-012']),
 ('restore-generated-views',['git','checkout','origin/main','--','ACCEPTANCE.md','docs/CLAIMS.md']),
 ('lock',['node','scripts/edition-authoring/cli.mjs','lock']),
 ('lock-check',['node','scripts/edition-authoring/cli.mjs','check']),
]
rows=[]
for name,args in commands:
 r=subprocess.run(args,cwd=root,capture_output=True,text=True)
 (packet/(name+'.log')).write_text(r.stdout+r.stderr)
 rows.append({'name':name,'command':' '.join(args),'exit':r.returncode,'output':name+'.log'})
 if r.returncode: break
receipt={'head':head,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commands':rows,'ledger':{'command':'none','exit':0,'reason':'no migrations changed'}}
(packet/'mechanical-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
raise SystemExit(any(row['exit'] for row in rows))
