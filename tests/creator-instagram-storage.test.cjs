const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('owner binding, deduplication, 24h window, uncertain send and service-only ACL',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',req='33333333-3333-4333-8333-333333333333',req2='44444444-4444-4444-8444-444444444444';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table public.sanji_connections(owner uuid,provider text,summary jsonb);insert into auth.users values('${owner}'),('${other}');`);
  await db.query('insert into public.sanji_connections values($1,$2,$3)',[owner,'instagram:42',{username:'valu_est',accountId:'42',connected:true,apiVerified:true}]);
  await db.exec(fs.readFileSync('supabase/migrations/202610300004_creator_instagram_inbox.sql','utf8'));
  const capture=(o,id,time=new Date().toISOString())=>db.query('select public.sanji_instagram_capture($1,$2,$3,$4,$5,$6) ok',[o,'42','43',id,time,'hello']);
  assert.equal((await capture(owner,'m1')).rows[0].ok,true);assert.equal((await capture(owner,'m1')).rows[0].ok,false);await assert.rejects(()=>capture(other,'m2'));
  const reserve=(o,id,r)=>db.query('select public.sanji_instagram_reserve_reply($1,$2,$3,$4,$5) result',[o,'42',id,r,'reply']);
  assert.equal((await reserve(owner,'m1',req)).rows[0].result.reserved,true);
  assert.equal((await reserve(owner,'m1',req)).rows[0].result.reserved,false);
  await capture(owner,'m2');await assert.rejects(()=>reserve(owner,'m2',req2));
  await db.query("select public.sanji_instagram_finish_reply($1,$2,'outcome_unknown',null)",[owner,req]);await assert.rejects(()=>reserve(owner,'m2',req2));
  await capture(owner,'old',new Date(Date.now()-25*3600000).toISOString());await assert.rejects(()=>reserve(owner,'old',req2));
  assert.equal((await db.query("select has_function_privilege('authenticated','public.sanji_instagram_reserve_reply(uuid,text,text,uuid,text)','EXECUTE') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
