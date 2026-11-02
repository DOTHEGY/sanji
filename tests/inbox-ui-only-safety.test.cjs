const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('dashboard honestly labels dot telemetry unconnected and does not call a new operations route',()=>{const s=fs.readFileSync('private/ui/app.js','utf8');assert.match(s,/dot 수집 원장 미연결/);assert.doesNotMatch(s,/\/operations-dashboard|\/dot-snapshot/)});
