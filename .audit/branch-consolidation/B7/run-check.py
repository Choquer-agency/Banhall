import subprocess,pathlib,sys,json,datetime
p=pathlib.Path('.audit/branch-consolidation/B7');name=sys.argv[1];cmd=sys.argv[2:]
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
with (p/(name+'.log')).open('w') as out:
 result=subprocess.run(cmd,stdout=out,stderr=subprocess.STDOUT)
(p/(name+'.exit')).write_text(str(result.returncode)+'\n')
(p/(name+'.command.json')).write_text(json.dumps({'command':cmd,'cwd':str(pathlib.Path.cwd()),'started':start,'exit':result.returncode},indent=2)+'\n')
print(name,'exit',result.returncode)
print('\n'.join((p/(name+'.log')).read_text().splitlines()[-16:]))
