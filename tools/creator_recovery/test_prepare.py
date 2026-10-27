import unittest,tempfile,csv
from pathlib import Path
from prepare import normalize,read
class TestRecovery(unittest.TestCase):
 def sample(self,**kw):
  d={'source_id':'1','source_row':'1','handle':'cook','profile_url':'https://www.instagram.com/cook/','source_kind':'instagram_profile_url_in_export','bio':'한국 요리 레시피 문의 cook@naver.com.','nickname':'','followers':'123','category':'푸드','category1':'','category2':'','source_file':'data','source_created_at':'2026-01-01'};d.update(kw);return d
 def test_punctuation_and_missing(self):
  a=normalize(self.sample());self.assertEqual(a['emails'],['cook@naver.com']);self.assertEqual(a['followers'],123);self.assertIsNone(a['last_verified'])
  self.assertEqual(normalize(self.sample(followers='0'))['followers'],0)
  self.assertEqual(normalize(self.sample(followers=''))['followers'],None)
  self.assertEqual(normalize(self.sample(bio=''))['email_status'],'아직 조회하지 않음')
  self.assertIn('이메일 없음',normalize(self.sample(bio='요리'))['email_status'])
 def test_scope(self):
  self.assertEqual(normalize(self.sample(source_kind='bookshopmap'))['assessment'],'review')
  missing=normalize(self.sample(profile_url='',source_kind='bookshopmap',bio='한국 요리 공식몰'));self.assertEqual(missing['link_status'],'needs_verification');self.assertEqual(missing['entity_type'],'noncreator_suspected')
  first=normalize(self.sample(handle='one',profile_url='https://www.instagram.com/one/',bio='한국 요리 x@shared.com'));second=normalize(self.sample(handle='two',profile_url='https://www.instagram.com/two/',bio='한국 요리 x@shared.com'));self.assertEqual(first['emails'],second['emails']);self.assertNotEqual(first['handle'],second['handle'])
  self.assertEqual(normalize(self.sample(bio='한국 요리 공식몰'))['assessment'],'review')
  self.assertEqual(normalize(self.sample(bio='food recipe'))['assessment'],'review')
 def test_escaping_only_marked_columns(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.csv'
   with p.open('w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=['bio','nickname','csv_escaped_fields']);w.writeheader();w.writerow({'bio':"'@contact",'nickname':"'original",'csv_escaped_fields':'bio'})
   row=next(read(p));self.assertEqual(row['bio'],'@contact');self.assertEqual(row['nickname'],"'original")
if __name__=='__main__':unittest.main()
