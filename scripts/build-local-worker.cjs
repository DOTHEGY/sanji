const fs=require('node:fs'),{execFileSync}=require('node:child_process');
fs.mkdirSync('public/downloads',{recursive:true});
execFileSync('python3',['-c',`import zipfile,pathlib
with zipfile.ZipFile('public/downloads/sanji-local-worker.zip','w',zipfile.ZIP_DEFLATED) as z:
 for name in ['package.json','package-lock.json','worker.cjs','README.md']:
  p=pathlib.Path('local-worker')/name
  if p.exists(): z.write(p,'sanji-local-worker/'+name)
`]);
