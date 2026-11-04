const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/proposals/creator_manual_notes.sql','utf8');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',creator='33333333-3333-4333-8333-333333333333',creator2='44444444-4444-4444-8444-444444444444',note='55555555-5555-4555-8555-555555555555',note2='66666666-6666-4666-8666-666666666666';
const payload={observedAt:'2020-02-29',sourceUrl:'https://www.instagram.com/direct/t/123/',inboundWhen:'Historical observation',summary:'Synthetic historical note',draft:'Synthetic draft',intent:'Review',afterInboundOutbound:'Unknown',recorderType:'user'};
async function setup(pre=''){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role extra;
 create table public.sanji_members(user_id uuid primary key);
 create table public.sanji_creator_recovery(id uuid primary key,owner uuid not null,handle text not null,entity_type text,assessment text,status text,unique(id,owner));
 create table public.provider_sentinel(body jsonb);
 insert into public.provider_sentinel values('{"verified":true,"body":"synthetic immutable provider fixture"}');
 grant select,update on public.sanji_members,public.sanji_creator_recovery to service_role;`);
 await db.query('insert into public.sanji_members values($1),($2)',[owner,other]);
 await db.query("insert into public.sanji_creator_recovery values($1,$2,'creator.one','creator_evidence','candidate','contacted'),($3,$2,'creator.two','creator_evidence','review','new')",[creator,owner,creator2]);
 if(pre)await db.exec(pre);
 return db;
}
async function save(db,over={}){
 const x={owner,creator,handle:'creator.one',note,payload,supersedes:null,...over};
 return (await db.query('select public.sanji_creator_manual_note_save($1,$2,$3,$4,$5,$6) result',[x.owner,x.creator,x.handle,x.note,JSON.stringify(x.payload),x.supersedes])).rows[0].result;
}
async function withDb(fn){const db=await setup();try{await db.exec(sql);await db.exec('set role service_role');await fn(db);}finally{await db.close();}}
test('append, exact retry, corrections, complete-payload conflicts and immutable provider state',()=>withDb(async db=>{
 const first=await save(db);assert.equal(first.duplicate,false);assert.deepEqual(first.note.payload,payload);assert.equal(first.note.recordType,'manual_historical_note');assert.equal(first.note.latestVerified,false);assert.equal(first.note.dispatchState,'not_sent');assert.equal(first.note.id,note);assert.equal(first.note.creatorId,creator);assert.ok(Number.isFinite(Date.parse(first.note.recordedAt)));
 assert.deepEqual(await save(db),{...first,duplicate:true});
 for(const change of [{payload:{...payload,summary:'Changed'}},{creator:creator2,handle:'creator.two'},{payload:Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='draft'))}])await assert.rejects(()=>save(db,change),/id conflict/);
 const correction=await save(db,{note:note2,supersedes:note,payload:{...payload,summary:'Correction'}});assert.equal(correction.note.supersedesId,note);
 await assert.rejects(()=>save(db,{supersedes:note2}),/id conflict/);
 assert.deepEqual((await db.query('select payload from public.sanji_creator_manual_notes where note_id=$1',[note])).rows[0].payload,payload);
 for(const query of ['update public.sanji_creator_manual_notes set payload=\'{}\'','delete from public.sanji_creator_manual_notes','truncate public.sanji_creator_manual_notes'])await assert.rejects(()=>db.exec(query),/permission denied/);
 await assert.rejects(()=>db.query('insert into public.sanji_creator_manual_notes(owner,creator_id,note_id,handle,payload,recorded_at) values($1,$2,$3,$4,$5,now())',[owner,creator,note2,'creator.one',JSON.stringify(payload)]),/permission denied/);
 await db.exec('reset role');assert.deepEqual((await db.query('select body from provider_sentinel')).rows[0].body,{verified:true,body:'synthetic immutable provider fixture'});
}));
test('target owner, membership, excluded state, stale handle and ambiguous identity fail closed including replay',()=>withDb(async db=>{
 await save(db);
 for(const over of [{owner:other},{creator:note2},{handle:'renamed'},{note:note2,supersedes:note2},{note:note2,supersedes:creator2},{creator:creator2,handle:'creator.two',note:note2,supersedes:note}])await assert.rejects(()=>save(db,over),/target unavailable/);
 for(const assignment of ["handle='renamed'","assessment='excluded'","status='excluded'","entity_type='unknown'","assessment=null","status=null"]){
  await db.exec('reset role');await db.query(`update public.sanji_creator_recovery set ${assignment} where id=$1`,[creator]);await db.exec('set role service_role');await assert.rejects(()=>save(db),/target unavailable/);
  await db.exec('reset role');await db.query("update public.sanji_creator_recovery set handle='creator.one',assessment='candidate',status='contacted',entity_type='creator_evidence' where id=$1",[creator]);await db.exec('set role service_role');
 }
 await db.exec('reset role');await db.query("update public.sanji_creator_recovery set handle='CREATOR.ONE' where id=$1",[creator2]);await db.exec('set role service_role');await assert.rejects(()=>save(db),/target unavailable/);
 await db.exec('reset role');await db.query('delete from public.sanji_members where user_id=$1',[owner]);await db.exec('set role service_role');await assert.rejects(()=>save(db),/membership required/);
}));
test('strict payload validation preserves observed precision and rejects invalid/future/provider claims',()=>withDb(async db=>{
 const invalid=[null,[],{}, {...payload,summary:''},{...payload,summary:'  '},{...payload,summary:'\t\n'},{...payload,summary:'x'.repeat(4001)},{...payload,draft:'x'.repeat(5001)},{...payload,inboundWhen:'x'.repeat(501)},{...payload,intent:'x'.repeat(501)},{...payload,afterInboundOutbound:'x'.repeat(501)},{...payload,recorderType:'provider'},{...payload,latestVerified:true},{...payload,draft:null},{...payload,intent:42}];
 for(const observedAt of ['1999-12-31','1999-12-31T23:59:59Z','2023-02-29','2020-02-30','2099-01-01','2020-01-01T24:00:00Z','2020-01-01T00:00:60Z','2020-01-01T00:00:00','2020-01-01T00:00:00Z trailing','2020-01-01T00:00:00.1234Z','2020-01-01T00:00:00.123456Z','2020-01-01T00:00:00.1234567Z','2020-02-30T00:00:00Z','yesterday'])invalid.push({...payload,observedAt});
 for(const sourceUrl of ['http://instagram.com/direct/t/123','https://evil.com/direct/t/123','https://instagram.com.evil.com/direct/t/123','https://user@instagram.com/direct/t/123','https://instagram.com/direct/t/123?q=1','https://instagram.com/direct/t/123#x','https://instagram.com/direct/t/a','https://instagram.com/direct/t/123\n'])invalid.push({...payload,sourceUrl});
 for(const p of invalid)await assert.rejects(()=>save(db,{payload:p}),/invalid manual note/);
 const precise={...payload,observedAt:'2020-02-29T12:34:56.123+09:00',draft:''};assert.deepEqual((await save(db,{payload:precise})).note.payload,precise);
}));
test('hostile defaults revoked, exact table/column/RPC ACLs, invoker/no policies and no legacy changes',async()=>{
 const db=await setup('alter default privileges grant all on tables to public,anon,authenticated,service_role;alter default privileges grant execute on functions to public,anon,authenticated,service_role;');
 try{
  const before=(await db.query("select relname,relacl::text from pg_class where oid in ('sanji_members'::regclass,'sanji_creator_recovery'::regclass,'provider_sentinel'::regclass) order by relname")).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query("select relname,relacl::text from pg_class where oid in ('sanji_members'::regclass,'sanji_creator_recovery'::regclass,'provider_sentinel'::regclass) order by relname")).rows,before);
  for(const role of ['anon','authenticated','service_role']){
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query("select has_table_privilege($1,'sanji_creator_manual_notes',$2) p",[role,privilege])).rows[0].p,role==='service_role'&&privilege==='SELECT');
   for(const col of ['owner','creator_id','note_id','handle','recorded_at','supersedes_id','payload'])assert.equal((await db.query("select has_column_privilege($1,'sanji_creator_manual_notes',$2,'INSERT') p",[role,col])).rows[0].p,role==='service_role'&&col!=='recorded_at');
   for(const signature of ['sanji_creator_manual_note_guard()','sanji_creator_manual_note_save(uuid,uuid,text,uuid,jsonb,uuid)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') p',[role,signature])).rows[0].p,role==='service_role'&&signature.includes('_save'));
  }
  assert.match((await db.query("select indexdef from pg_indexes where indexname='sanji_creator_manual_notes_owner_page'")).rows[0].indexdef,/\(owner, recorded_at DESC, note_id DESC\)/);
  assert.equal((await db.query("select count(*)::int n from pg_policy where polrelid='sanji_creator_manual_notes'::regclass")).rows[0].n,0);
  assert.equal((await db.query("select bool_and(not prosecdef) ok from pg_proc where proname in ('sanji_creator_manual_note_guard','sanji_creator_manual_note_save')")).rows[0].ok,true);
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>save(db),/permission denied/);await assert.rejects(()=>db.exec('select * from sanji_creator_manual_notes'),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');await save(db);
  await assert.rejects(()=>db.query('insert into sanji_creator_manual_notes(owner,creator_id,note_id,handle,payload) values($1,$2,$3,$4,$5)',[other,creator,note2,'creator.one',JSON.stringify(payload)]),/target unavailable/);
 }finally{await db.close();}
});
test('unexpected inherited access, owner membership, broad role and late column grants roll proposal back',async()=>{
 const cases=[
  'grant extra to service_role;alter default privileges grant all on tables to extra;',
  'grant service_role to authenticated;',
  'create role elevated superuser;alter role service_role noinherit;grant elevated to service_role;',
  `create function inject_column() returns event_trigger language plpgsql as $$begin if to_regclass('public.sanji_creator_manual_notes') is not null then execute 'grant select(payload) on public.sanji_creator_manual_notes to anon';end if;end$$;create event trigger inject_column on ddl_command_end when tag in ('CREATE FUNCTION') execute function inject_column();`,
  'grant pg_write_all_data to service_role;',
  `alter role service_role noinherit;grant extra to service_role;create function inject_owner() returns event_trigger language plpgsql as $$begin if to_regclass('public.sanji_creator_manual_notes') is not null then execute 'alter table public.sanji_creator_manual_notes owner to extra';end if;end$$;create event trigger inject_owner on ddl_command_end when tag in ('CREATE TABLE') execute function inject_owner();`,
 ];
 for(const pre of cases){const db=await setup(pre);try{await assert.rejects(()=>db.exec(sql),/unexpected|unsafe/);await db.exec('rollback');assert.equal((await db.query("select to_regclass('public.sanji_creator_manual_notes') name")).rows[0].name,null);}finally{await db.close();}}
});

test('composite owner/creator foreign key prevents cross-owner corrections and owner-scoped IDs remain isolated',()=>withDb(async db=>{
 await save(db);
 await db.exec('reset role');
 await db.query("insert into sanji_creator_recovery values($1,$2,'other.creator','creator_evidence','candidate','new')",[note2,other]);
 await db.exec('set role service_role');
 await assert.rejects(()=>save(db,{owner:other,creator:note2,handle:'other.creator',note:creator2,supersedes:note}),/correction target unavailable/);
 const second=await save(db,{owner:other,creator:note2,handle:'other.creator'});assert.equal(second.duplicate,false);
 assert.equal((await db.query('select count(*)::int n from sanji_creator_manual_notes')).rows[0].n,2);
}));

test('release migration exactly matches reviewed SQL after header',()=>{const migration=fs.readFileSync('supabase/migrations/20261104064214_creator_manual_notes.sql','utf8');const proposal=fs.readFileSync('supabase/proposals/creator_manual_notes.sql','utf8');assert.equal(migration.slice(migration.indexOf('\n')),proposal.slice(proposal.indexOf('\n')));});
