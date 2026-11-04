'use strict';
// Entirely in-memory PGlite; no operating database, credentials, or user data.
const {test}=require('node:test'), assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
test('concurrent unique index is standalone and supplies the FK referenced key',async()=>{const db=new PGlite();try{
 const ver=(await db.query('show server_version')).rows[0].server_version;console.log('Synthetic DB version:',ver);
 await db.exec('create table parent (id int primary key, owner int not null); create table child (creator_id int not null, owner int not null)');
 await assert.rejects(()=>db.exec('alter table child add foreign key(creator_id,owner) references parent(id,owner)'));
 await db.exec('create unique index concurrently synthetic_parent_owner_idx on parent(id,owner)');
 const result=await db.query("select indisvalid,indisready,indisunique from pg_index where indexrelid='synthetic_parent_owner_idx'::regclass");assert.deepEqual(result.rows,[{indisvalid:true,indisready:true,indisunique:true}]);
 await db.exec('alter table child add foreign key (creator_id,owner) references parent(id,owner)');
 await db.exec('insert into parent values (1,10); insert into child values (1,10)');
 await assert.rejects(()=>db.exec('insert into child values (1,11)'));
 await assert.rejects(()=>db.exec('update parent set owner=11 where id=1'));
 }finally{await db.close();}});
test('concurrent index cannot run inside a transaction block',async()=>{const db=new PGlite();try{await db.exec('create table parent(id int primary key,owner int not null)');await db.exec('begin');await assert.rejects(()=>db.exec('create unique index concurrently idx_inside_tx on parent(id,owner)'),e=>e.code==='25001');await db.exec('rollback');}finally{await db.close();}});
test('failed concurrent unique build leaves invalid index and cleanup is a separate statement',async()=>{const db=new PGlite();try{await db.exec('create table test_duplicates(a int,b int); insert into test_duplicates values(1,1),(1,1)');await assert.rejects(()=>db.exec('create unique index concurrently invalid_idx on test_duplicates(a,b)'),e=>e.code==='23505');const rows=(await db.query("select indisvalid,indisready from pg_index where indexrelid=to_regclass('public.invalid_idx')")).rows;assert.equal(rows.length,1);assert.equal(rows[0].indisvalid,false);await db.exec('drop index concurrently invalid_idx');assert.equal((await db.query("select to_regclass('public.invalid_idx') as name")).rows[0].name,null);}finally{await db.close();}});
