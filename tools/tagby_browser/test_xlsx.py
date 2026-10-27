import tempfile,unittest
from pathlib import Path
from openpyxl import Workbook
from import_xlsx import from_workbook,stage,HEADERS
class TagbyWorkbook(unittest.TestCase):
 def workbook(self,folder,rows):
  f=Path(folder)/'test.xlsx';w=Workbook();w.active.append(HEADERS)
  for row in rows:w.active.append(row)
  w.save(f);return f
 def test_verified_schema_and_idempotent_evidence(self):
  with tempfile.TemporaryDirectory() as d:
   f=self.workbook(d,[['높음','food1','https://www.instagram.com/food1/',123,4,0],['보통','food2','https://www.instagram.com/food2/',0,0,'12.6만']]);r=from_workbook(f,'seed1');self.assertEqual(r[0]['followers'],0);self.assertEqual(r[1]['followers'],126000);self.assertEqual(r[0]['similarity'],'높음');self.assertEqual(r[0]['source_ref'],'seed1');p=Path(d)/'state.json';self.assertEqual(stage(r,p),2);self.assertEqual(stage(r,p),0);self.assertEqual(stage(from_workbook(f,'seed2'),p),2)
 def test_bad_link_and_formula_are_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   f=self.workbook(d,[['높음','food1','https://www.instagram.com/other/',1,2,3]])
   with self.assertRaises(ValueError):from_workbook(f)
   f=self.workbook(d,[['높음','food1','https://www.instagram.com/food1/','=1+1',2,3]])
   with self.assertRaises(ValueError):from_workbook(f)
if __name__=='__main__':unittest.main()
