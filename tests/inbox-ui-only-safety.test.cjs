const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('dashboard labels missing dot telemetry and never calls the broad operations route',()=>{const s=fs.readFileSync('private/ui/app.js','utf8');assert.match(s,/오늘 수신된 원장이 없습니다/);assert.match(s,/\/dot-snapshot/);assert.doesNotMatch(s,/\/operations-dashboard/)});
