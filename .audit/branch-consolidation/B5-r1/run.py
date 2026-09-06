import subprocess,sys,json,datetime
from pathlib import Path
root=Path(__file__).resolve().parent
name=sys.argv[1]
command=sys.argv[2:]
with (root/(name+'.log')).open('w') as out:
    result=subprocess.run(command,stdout=out,stderr=subprocess.STDOUT)
with (root/'commands.jsonl').open('a') as out:
    out.write(json.dumps({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'name':name,'command':command,'exit':result.returncode})+'\n')
print(name, 'exit', result.returncode)
print((root/(name+'.log')).read_text()[-3000:])
sys.exit(result.returncode)
