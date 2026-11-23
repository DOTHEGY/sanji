import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
test('installed pgcrypto generates one private key when Partyum is OFF; service is SELECT-only; no browser reads',async t=>{
 if(!process.env.PARTYUM_PGLITE){t.skip('set PARTYUM_PGLITE path');return;}
 const engine=pathToFileURL(process.env.PARTYUM_PGLITE);
 const {PGlite}=await import(engine);
 const {pgcrypto}=await import(new URL('./contrib/pgcrypto.js',engine));
 const db=new PGlite({extensions:{pgcrypto}});t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema extensions;create extension pgcrypto schema extensions;`);
 const apply=async name=>db.exec(await fs.readFile(new URL(name,import.meta.url),'utf8'));
 await apply('0001_partyum_ledger.unapplied.sql');
 await apply('0003_partyum_runtime_control.unapplied.sql');
 const keyfile='0005_partyum_plan_key.unapplied.sql';
 await db.exec('update sanji_partyum_internal.partyum_runtime_controls set send_enabled=true');
 await assert.rejects(()=>apply(keyfile),/Disable Partyum/);await db.exec('rollback');
 await db.exec('update sanji_partyum_internal.partyum_runtime_controls set send_enabled=false');
 await apply(keyfile);
 await db.exec('set role service_role');
 const q=await db.query('select count(*)::int n, min(octet_length(material)) len from sanji_partyum_internal.partyum_plan_key');
 assert.deepEqual(q.rows,[{n:1,len:32}]);
 await assert.rejects(()=>db.exec("update sanji_partyum_internal.partyum_plan_key set material=extensions.gen_random_bytes(32)"),/permission denied/);
 await assert.rejects(()=>db.exec("delete from sanji_partyum_internal.partyum_plan_key"),/permission denied/);
 for(const role of ['anon','authenticated']){
  await db.exec('reset role;set role '+role);
  await assert.rejects(()=>db.query('select material from sanji_partyum_internal.partyum_plan_key'),/permission denied/);
 }
 await db.exec('reset role');
 await assert.rejects(()=>apply(keyfile),/already exists/);await db.exec('rollback');
 assert.deepEqual((await db.query('select count(*)::int n from sanji_partyum_internal.partyum_plan_key')).rows,[{n:1}]);
});
