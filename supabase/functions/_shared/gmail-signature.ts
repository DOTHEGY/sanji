const decode=(s:string)=>s.replace(/&#(x[0-9a-f]+|\d+);?/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[k.toLowerCase()]||''));
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function gmailSignature(input:string){
 if(typeof input!=="string"||input.length>30000)throw Error('Gmail 서명 크기 제한');
 const allowed=new Set('div span p br b strong i em u small table tbody tr td th a img font hr'.split(' '));
 const html=input.replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'').split(/(<\/?[A-Za-z][^>]*>)/g).map(token=>{
  if(!token.startsWith('<'))return escape(decode(token));const match=/^<(\/?)([A-Za-z][\w:-]*)\b([^>]*)>$/.exec(token);if(!match)return escape(token);const name=match[2].toLowerCase();if(!allowed.has(name))return '';if(match[1])return ['img','br','hr'].includes(name)?'':'</'+name+'>';
  const attrs:any={};for(const m of match[3].matchAll(/(?:^|\s)([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]??'');const out:string[]=[];
  if(name==='a'||name==='img'){const key=name==='a'?'href':'src',value=attrs[key]||'';try{const u=new URL(value);if(!(name==='img'?['https:']:['https:','http:','mailto:','tel:']).includes(u.protocol)||u.username||u.password||/\/email-events\/pixel\//.test(u.pathname))return '';out.push(key+'="'+escape(u.toString())+'"');}catch{return '';}if(name==='a')out.push('rel="noopener noreferrer"');}
  if(name==='img'){if(Number(attrs.width)===1&&Number(attrs.height)===1)return '';out.push('alt="'+escape(attrs.alt||'서명 이미지')+'"');for(const k of ['width','height'])if(/^\d{1,4}$/.test(attrs[k]||''))out.push(k+'="'+attrs[k]+'"');}
  const styles=[];for(const part of String(attrs.style||'').split(';')){const [raw,...rest]=part.split(':'),k=raw.trim().toLowerCase(),v=rest.join(':').trim();if(['color','background-color'].includes(k)&&/^(#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d., %]+\))$/i.test(v)||['font-size','line-height','padding','margin','width','height'].includes(k)&&/^[\d.]+(?:px|pt|em|%)?$/.test(v)||k==='font-weight'&&/^(normal|bold|[1-9]00)$/.test(v)||k==='text-align'&&/^(left|right|center)$/.test(v)||k==='font-family'&&/^[a-zA-Z0-9 ,'-]{1,100}$/.test(v))styles.push(k+':'+v);}
  if(styles.length)out.push('style="'+escape(styles.join(';'))+'"');return '<'+name+(out.length?' '+out.join(' '):'')+'>';
 }).join('');
 const text=decode(html.replace(/<img\b[^>]*>/gi,'[서명 이미지]').replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,(_,url,label)=>label+(decode(label.replace(/<[^>]*>/g,''))===decode(url)?'':' ('+url+')')).replace(/<br\s*\/?\s*>|<\/(?:div|p|tr)>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/\n{3,}/g,'\n\n').trim();
 return {html,text};
}
export function selectGmailSignature(result:any,email:string){const row=(result.sendAs||[]).find((r:any)=>String(r.sendAsEmail||'').toLowerCase()===String(email).toLowerCase());if(!row)throw Error('현재 Gmail 발신 주소의 서명을 확인하지 못했습니다. 다른 별칭의 서명을 자동 사용하지 않습니다.');return {...gmailSignature(String(row.signature||'')),email:row.sendAsEmail};}
