const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/workspace/youtube');
fs.mkdirSync(out, { recursive: true });
esbuild.buildSync({entryPoints:[path.join(root,'web/youtube-discovery.js')],bundle:true,outfile:path.join(out,'app.js'),platform:'browser',target:'es2022',format:'iife',minify:true});
let html=fs.readFileSync(path.join(root,'private/youtube-discovery/index.html'),'utf8');
for(const file of ['app.js','style.css']){
 if(file==='style.css')fs.copyFileSync(path.join(root,'private/youtube-discovery',file),path.join(out,file));
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex').slice(0,12);
 html=html.replace(`./${file}`,`./${file}?v=${hash}`);
}
fs.writeFileSync(path.join(out,'index.html'),html);
console.log('Isolated YouTube discovery built: public/workspace/youtube/');
