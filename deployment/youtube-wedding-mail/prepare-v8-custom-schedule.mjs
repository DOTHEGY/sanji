// Prepare an additive change to the separately deployed, protected production
// mail bundle. This command reads and writes local files only. It never deploys.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const [baselineDirectory,outputDirectory]=process.argv.slice(2);
if(!baselineDirectory||!outputDirectory||resolve(baselineDirectory)===resolve(outputDirectory))throw Error('Provide separate baseline and existing output directories');
const sha=x=>createHash('sha256').update(x).digest('hex');
const baseline=await readFile(resolve(baselineDirectory,'index.ts'),'utf8');
const incident=await readFile(resolve(baselineDirectory,'incident-only.mjs'),'utf8');
if(sha(baseline)!=='63f2efc15fe42ab8370589819f8f9842b3deb0431aa23f9922ba57f1dc17c459'||
   sha(incident)!=='3ec2a4e131ac64c0c3030001c72b705a1b76d0101129ca1f429ec478cf9ff3cd')
 throw Error('Wrong live mail v8 source; re-review instead of applying this patch');
let next=baseline;
function replace(before,after){
 if(next.split(before).length!==2)throw Error('Expected one matching baseline block');
 next=next.replace(before,()=>after);
}
const helper=(await readFile(new URL('../../web/youtube-wedding-schedule.mjs',import.meta.url),'utf8'))
 .split('export function weddingScheduleAtKst')[0].replaceAll('export ','');
replace('var runAtFor = (mode, t) => mode === "now" ? iso(t) : iso(Date.parse(dayAt(t) + "T01:00:00Z") + 864e5);',
 helper+'var runAtFor = (scope, t) => scope.mode === "scheduled" ? scope.scheduleAt : scope.mode === "now" ? iso(t) : iso(Date.parse(dayAt(t) + "T01:00:00Z") + 864e5);');
replace('  const keys = ["action", "projectId", "day", "channelIdsExcluded", "mode"];',
 '  const keys = ["action", "projectId", "day", "channelIdsExcluded", "mode"];\n  if (v?.mode === "scheduled") keys.push("scheduleAt");');
replace('!["now", "tomorrow"].includes(v.mode)','!["now", "tomorrow", "scheduled"].includes(v.mode)');
replace('return { projectId: PROJECT, day: v.day, mode: v.mode, channelIdsExcluded: [...v.channelIdsExcluded].sort() };',
 'return { projectId: PROJECT, day: v.day, mode: v.mode, channelIdsExcluded: [...v.channelIdsExcluded].sort(), ...(v.mode === "scheduled" ? { scheduleAt: v.scheduleAt } : {}) };');
replace('    if (input.action === "plan") {\n      const snapshot',
 '    if (input.action === "plan") {\n      if (scope.mode === "scheduled" && !validWeddingScheduleAt(scope.scheduleAt, t)) throw FAIL("SCOPE");\n      const snapshot');
replace('runAtFor(scope.mode, t), expiresAt','runAtFor(scope, t), expiresAt');
replace('scope.mode === "tomorrow" && claim.runAt !== runAtFor(scope.mode, t)) throw FAIL("PLAN_STALE");',
 'scope.mode === "tomorrow" && claim.runAt !== runAtFor(scope, t) || scope.mode === "scheduled" && (claim.runAt !== scope.scheduleAt || !validWeddingScheduleAt(scope.scheduleAt, t))) throw FAIL("PLAN_STALE");');
replace('      const again = await recomputePartyumEligibility(await readLocked(q, x, t), x, t);',
 '      if (x.mode === "scheduled" && (x.runAt !== x.scheduleAt || !validWeddingScheduleAt(x.runAt, t))) throw fail2("PLAN_STALE");\n      const again = await recomputePartyumEligibility(await readLocked(q, x, t), x, t);');
await writeFile(resolve(outputDirectory,'index.ts'),next,{flag:'wx',mode:0o600});
await writeFile(resolve(outputDirectory,'incident-only.mjs'),incident,{flag:'wx',mode:0o600});
console.log('Prepared local mail bundle only; index source sha256: '+sha(next));
