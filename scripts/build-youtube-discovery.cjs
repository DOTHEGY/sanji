const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public/workspace/youtube');
fs.mkdirSync(out, { recursive: true });
esbuild.buildSync({entryPoints:[path.join(root,'web/youtube-discovery-direct.js')],bundle:true,outfile:path.join(out,'app.js'),platform:'browser',target:'es2022',format:'iife',minify:true});
let html=fs.readFileSync(path.join(root,'private/youtube-discovery/index.html'),'utf8');
for(const file of ['app.js','style.css']){
 if(file==='style.css')fs.copyFileSync(path.join(root,'private/youtube-discovery',file),path.join(out,file));
 const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex').slice(0,12);
 html=html.replace(`./${file}`,`./${file}?v=${hash}`);
}
fs.writeFileSync(path.join(out,'index.html'),html);
console.log('Isolated YouTube discovery built: public/workspace/youtube/');
const wedding=path.join(out,'wedding');
fs.mkdirSync(wedding,{recursive:true});
esbuild.buildSync({entryPoints:[path.join(root,'web/youtube-wedding.js')],bundle:true,outfile:path.join(wedding,'app.js'),platform:'browser',target:'es2022',format:'iife',minify:true});
const weddingJs=crypto.createHash('sha256').update(fs.readFileSync(path.join(wedding,'app.js'))).digest('hex').slice(0,12);
const weddingCss=crypto.createHash('sha256').update(fs.readFileSync(path.join(out,'style.css'))).digest('hex').slice(0,12);
fs.writeFileSync(path.join(wedding,'index.html'),fs.readFileSync(path.join(root,'private/youtube-wedding/index.html'),'utf8')
 .replace('./app.js','./app.js?v='+weddingJs).replace('../style.css','../style.css?v='+weddingCss));
