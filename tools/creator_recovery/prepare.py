#!/usr/bin/env python3
"""Prepare an offline, reviewable creator import; never contacts external services."""
import argparse,csv,json,re,hashlib
from pathlib import Path
from collections import Counter
EMAIL=re.compile(r'(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9-]|\.[A-Za-z])')
HANDLE=re.compile(r'^[a-z0-9._]{1,30}$')
TOPIC=re.compile(r'요리|레시피|식단|푸드|먹방|운동|헬스|웰니스|라이프|일상|육아|건강식품|공동구매|공구|F&B|food|recipe|fitness|wellness',re.I)
ENTITY=re.compile(r'팬계정|팬 계정|팬페이지|fan\s*(account|page)|공식몰|쇼핑몰|온라인몰|주식회사|기관|병원|협회|공식계정|official\s*(store|shop)|브랜드 공식',re.I)
ROLE=re.compile(r'크리에이터|인플루언서|유튜버|블로거|creator|influencer|blogger',re.I)
CREATOR=re.compile(r'크리에이터|인플루언서|유튜버|블로거|creator|influencer|blogger|레시피|요리|운동|살림|육아|일상|먹방',re.I)
KOREAN=re.compile(r'[가-힣]')
def read(path):
 with open(path,encoding='utf-8-sig',newline='') as f:
  for row in csv.DictReader(f):
   for k in row.get('csv_escaped_fields','').split(';'):
    if k and row.get(k,'').startswith("'"):row[k]=row[k][1:]
   yield row

def normalize(row):
 h=row['handle'].strip().lstrip('@').lower();url=row['profile_url'].strip();bio=row['bio'];category=' '.join(row.get(k,'') for k in ('category','category1','category2'))
 valid=bool(HANDLE.fullmatch(h)) and row['source_kind']=='instagram_profile_url_in_export' and bool(re.fullmatch(r'https?://(?:www\.)?instagram\.com/'+re.escape(h)+r'/?(?:\?.*)?',url,re.I))
 topic_category=bool(TOPIC.search(category));topic_bio=bool(TOPIC.search(bio));role=bool(ROLE.search(bio));identity=bool(CREATOR.search(bio));korean=bool(KOREAN.search(bio));entity=bool(ENTITY.search(bio+' '+category))
 reasons=[]
 if not valid: status='review';reasons.append('Instagram 프로필 링크와 계정 관계 확인 필요')
 elif entity: status='review';reasons.append('개인 계정 여부 확인 필요')
 elif korean and ((topic_category and topic_bio) or (topic_bio and role)): status='candidate';reasons.append('한국어 소개와 카테고리·소개란 또는 소개란의 주제·창작자 역할 단서 복수 확인 · 국적 및 최신 활동 미확인')
 else: status='review';reasons.append('한국 크리에이터·주제·계정 유형 근거 부족')
 emails=list(dict.fromkeys(m.group(0).lower() for m in EMAIL.finditer(bio)))
 followers=int(row['followers']) if row['followers'].isdigit() else None
 return {'source_id':row['source_id'],'source_row':row['source_row'],'handle':h,'profile_url':url,'nickname':row['nickname'],'followers':followers,'category':category.strip(),'bio':bio,'emails':emails,'email_status':'소개란 공개 · 유효성 미검증' if emails else ('이메일 없음 · 과거 소개란 기준' if bio else '아직 조회하지 않음'),'source_kind':row['source_kind'],'source_file':row['source_file'],'source_created_at':row['source_created_at'],'last_verified':None,'link_status':'source_confirmed' if valid else 'needs_verification','entity_type':'noncreator_suspected' if entity else ('creator_evidence' if identity else 'unknown'),'assessment':status,'reasons':reasons,'limitations':['국적·현재 활동·이메일 유효성 미검증'],'status':'new'}

def prepare(src,out):
 records=[];seen=set();counts=Counter();emails=Counter()
 for raw in read(src/'all_records_clean.csv'):
  row=normalize(raw);counts[row['assessment']]+=1
  if row['handle'] in seen:raise ValueError('duplicate handle')
  seen.add(row['handle']);records.append(row)
  for email in row['emails']:emails[email]+=1
 out.mkdir(parents=True,exist_ok=True)
 with open(out/'prepared-private.jsonl','w',encoding='utf8') as f:
  for row in records:f.write(json.dumps(row,ensure_ascii=False)+'\n')
 result={'source_rows':len(records),'assessment':dict(counts),'email_accounts':sum(bool(r['emails']) for r in records),'shared_email_keys':sum(v>1 for v in emails.values()),'input_sha256':hashlib.sha256((src/'all_records_clean.csv').read_bytes()).hexdigest(),'automatic_execution':False,'production_imported':False}
 (out/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);a=p.parse_args();print(json.dumps(prepare(a.source,a.output),ensure_ascii=False,indent=2))
