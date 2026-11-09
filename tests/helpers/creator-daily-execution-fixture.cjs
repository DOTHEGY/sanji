// Synthetic local-only schema fixture. No production connection or provider.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const sid='33333333-3333-4333-8333-333333333333',pid='44444444-4444-4444-8444-444444444444',pid2='55555555-5555-4555-8555-555555555555',cid='66666666-6666-4666-8666-666666666666';
const key='youtube:UC0000000000000000000001',recipient='first.last+campaign@gmail.com';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const settings={signatureSource:'gmail',gmailSignatureEmail:'owner@gmail.com',gmailSignatureHtml:'<b>서명</b>',emailSignature:'서명',senderName:'대표'};
const product={name:'마라쫀득빵',state:'확정',productUrl:'https://example.com/product'};
const policy={classification:'reviewed_non_marketing_business_proposal',classificationSource:'explicit individual content review',authorizationSource:'user explicit authorization',schedule:{timezone:'Asia/Seoul',hour:9,minute:0,confirmed:true}};
async function query(db,sql,args=[]){return (await db.query(sql,args)).rows;}
async function rpc(db,name,...args){return (await query(db,`select sanji_daily_campaign_${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;}
async function setup(){const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');create table sanji_members(user_id uuid);insert into sanji_members values('${owner}'),('${other}');
 create table sanji_records(id uuid primary key default gen_random_uuid(),owner uuid,kind text,version int default 1,data jsonb,updated timestamptz default now());
 create unique index sanji_campaign_fixture_company_unique on sanji_records(owner,lower(data->>'companyKey')) where kind='candidate' and coalesce(data->>'companyKey','')<>'';create unique index sanji_campaign_fixture_email_unique on sanji_records(owner,lower(data#>>'{contact,email}')) where kind='candidate' and coalesce(data#>>'{contact,email}','')<>'';create unique index sanji_campaign_fixture_handle_unique on sanji_records(owner,lower(data->>'handle')) where kind='candidate' and coalesce(data->>'handle','')<>'';create unique index sanji_campaign_fixture_settings_unique on sanji_records(owner) where kind='settings';
 create table sanji_creator_recovery(id uuid primary key,owner uuid,handle text,nickname text,profile_url text,status text default 'new',entity_type text default 'creator_evidence',link_status text default 'source_confirmed',assessment text default 'candidate',followers bigint,followers_source text,followers_checked timestamptz,updated timestamptz default now(),unique(id,owner));
 create table sanji_creator_evidence(owner uuid,creator_id uuid,source_kind text,source_provider text not null default 'unknown',source_url text default '',source_ref text default '',observation_key text default '',detail jsonb,seen_at timestamptz default now(),primary key(owner,creator_id,source_kind,source_url,source_ref,observation_key));
 create table sanji_creator_contact_review(owner uuid,creator_id uuid,data jsonb);create table sanji_creator_inbound_messages(owner uuid,creator_id uuid,data jsonb);create table sanji_creator_manual_notes(owner uuid,creator_id uuid,handle text,payload jsonb);create table sanji_ig_manual_conversations(owner uuid,creator_id uuid,username text);create table sanji_creator_email_isolated_queue(owner uuid,creator_id uuid,snapshot jsonb);create table sanji_instagram_inbound(owner uuid,body text);create table sanji_instagram_reply_attempts(owner uuid,body text);
 create table sanji_connections(owner uuid,provider text,summary jsonb);create table sanji_suppression(owner uuid,identity text);create table sanji_audit(owner uuid,action text,data jsonb);
 create table sanji_outbox(id uuid primary key default gen_random_uuid(),owner uuid,target uuid not null,channel text,fingerprint text unique,status text,data jsonb,created timestamptz default now());
 create table sanji_drafts(id uuid primary key default gen_random_uuid(),owner uuid,data jsonb,hash text,expires timestamptz,used boolean default false);create table sanji_jobs(id uuid default gen_random_uuid(),owner uuid,draft_id uuid);
 create function sanji_blocked(uuid,jsonb) returns boolean language sql as 'select false';
 grant select,insert,update on all tables in schema public to service_role;
 `);for(const name of ['creator-daily-outreach','creator-daily-supply','creator-daily-instagram-review','creator-contact-enrichment','creator-daily-campaign','creator-daily-retention','creator-daily-recipient-criteria-upgrade','creator-daily-execution-reads']) await db.exec(fs.readFileSync('supabase/pending/'+name+'.sql','utf8'));
 for(const [id,kind,data] of [[sid,'settings',settings],[pid,'deal',product],[pid2,'deal',{...product,name:'짬뽕쫀득빵'}]])await query(db,'insert into sanji_records(id,owner,kind,data) values($1,$2,$3,$4)',[id,owner,kind,data]);
 await query(db,"insert into sanji_connections values($1,'gmail',$2)",[owner,{email:'owner@gmail.com'}]);return db;}

module.exports={setup,query,owner,other,cid};
