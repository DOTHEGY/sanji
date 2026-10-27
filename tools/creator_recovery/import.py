#!/usr/bin/env python3
"""Idempotent Supabase Management import. Dry-run unless --apply is explicitly supplied."""
import argparse,json,os,urllib.request,uuid,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('file',type=Path);p.add_argument('--owner',required=True,type=uuid.UUID);p.add_argument('--project',required=True);p.add_argument('--apply',action='store_true');p.add_argument('--batch-size',type=int,default=100);a=p.parse_args()
if not 1<=a.batch_size<=200:raise SystemExit('batch-size 1..200')
rows=[json.loads(x) for x in a.file.read_text(encoding='utf8').split('\n') if x];print(json.dumps({'input_sha256':hashlib.sha256(a.file.read_bytes()).hexdigest(),'rows':len(rows),'mode':'apply' if a.apply else 'dry-run'}))
if not a.apply:raise SystemExit(0)
if not os.environ.get('SUPABASE_ACCESS_TOKEN'):raise SystemExit('SUPABASE_ACCESS_TOKEN required')
# Existing rows, operator statuses, and verified refreshes are never overwritten.
q='''insert into public.sanji_creator_recovery(owner,handle,source_id,profile_url,nickname,followers,category,bio,emails,bio_status,email_status,source_kind,source_file,source_created_at,last_verified,link_status,entity_type,priority_score,assessment,reasons,status)
select $1::uuid,x.handle,x.source_id,x.profile_url,x.nickname,x.followers,x.category,x.bio,x.emails,x.bio_status,x.email_status,x.source_kind,x.source_file,nullif(x.source_created_at,\'\')::timestamptz,nullif(x.last_verified,\'\')::timestamptz,x.link_status,x.entity_type,x.priority_score,x.assessment,x.reasons,\'new\'
from jsonb_to_recordset($2::jsonb) as x(handle text,source_id text,profile_url text,nickname text,followers bigint,category text,bio text,emails jsonb,bio_status text,email_status text,source_kind text,source_file text,source_created_at text,last_verified text,link_status text,entity_type text,priority_score integer,assessment text,reasons jsonb)
on conflict do nothing returning handle'''
for start in range(0,len(rows),a.batch_size):
 body=json.dumps({'query':q,'parameters':[str(a.owner),json.dumps(rows[start:start+a.batch_size],ensure_ascii=False)]}).encode();req=urllib.request.Request('https://api.supabase.com/v1/projects/'+a.project+'/database/query',data=body,headers={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN'],'Content-Type':'application/json'},method='POST')
 with urllib.request.urlopen(req,timeout=60) as res: result=json.load(res)
 print(json.dumps({'offset':start,'processed':min(a.batch_size,len(rows)-start),'inserted':len(result)}),flush=True)
