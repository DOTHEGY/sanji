#!/usr/bin/env node
// Local preprocessing only. Raw JSON is read into process memory; never uploaded or logged.
const fs=require('node:fs');
const {projectRows,groupsFor}=require('../private/ui/instagram-transient-products.js');
try {
 const [mode,first,second,mappingPath,...extra]=process.argv.slice(2);
 if(!['inspect','build'].includes(mode)||!first||!second||extra.length||(mode==='inspect'&&mappingPath)||(mode==='build'&&!mappingPath))throw Error('usage');
 const read=p=>{const b=fs.readFileSync(p);if(b.length>524288)throw Error('size');return JSON.parse(b.toString('utf8'));};
 const a=read(first),b=read(second);if(!Array.isArray(a)||!Array.isArray(b))throw Error('format');
 const rows=projectRows([...a,...b]);
 if(mode==='inspect'){process.stdout.write(JSON.stringify({rows},null,2)+'\n');}
 else {const spec=read(mappingPath);if(!spec||spec.confirmed!==true)throw Error('confirmation');const projected=groupsFor(rows,spec.mapping,true);process.stdout.write(JSON.stringify({rows:rows.map(()=>({})),mapping:spec.mapping.map((x,i)=>({rows:[...x.rows],representative:x.representative,...(projected[i].name?{displayName:projected[i].name,displayNameReviewed:true}:{})}))},null,2)+'\n');}
} catch {process.stderr.write('입력 형식, 37개 수동 매핑 또는 확인 상태를 다시 확인하세요. 원문 내용은 출력하지 않습니다.\n');process.exitCode=1;}
