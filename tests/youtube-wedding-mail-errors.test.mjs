import assert from 'node:assert/strict';
import test from 'node:test';
import {readWeddingMailPlanFailure,weddingMailPlanErrorMessage} from '../web/youtube-wedding-mail-errors.mjs';
const reply=(body,status=503)=>Response.json(body,{status});
test('sanitized plan-specific codes distinguish disabled, connection, and template paths without raw payload',async()=>{
 const cases=[
  ['PARTYUM_DISABLED',503,/일시 중지/],
  ['GLOBAL_EMAIL_DISABLED',503,/메일 발송이 비활성화/],
  ['PARTYUM_CONTROL_UNAVAILABLE',503,/발송 설정/],
  ['ADMISSION_UNVERIFIED',503,/조회가 완료되지/],
  ['SOURCE_UNVERIFIED',503,/발송 준비 상태/],
  ['COPY_REVIEW_REQUIRED',409,/사용 승인 기록/],
 ];
 for(const [code,status,display] of cases){
  const typed=await readWeddingMailPlanFailure(reply({error:code},status));
  assert.equal(typed,code);
  const message=weddingMailPlanErrorMessage(typed,'request');
  assert.match(message,display);
  assert.match(message,/발송·예약 요청은 하지 않았습니다/);
  assert.doesNotMatch(message,new RegExp(code));
 }
});
test('gateway messages or unexpected status/body never become typed or render raw values',async()=>{
 for(const response of [
  reply({error:'PARTYUM_DISABLED'},401),
  reply({error:'PARTYUM_DISABLED',recipient:'private@example.test'}),
  reply({error:'private@example.test'}),
  reply({code:'401',message:'Not authorized'},401),
  new Response('gateway private@example.test',{status:503}),
 ]){
  const typed=await readWeddingMailPlanFailure(response);
  assert.equal(typed,null);
  assert.doesNotMatch(weddingMailPlanErrorMessage(typed,'request'),/private@|Not authorized/);
 }
});
test('post-plan local copy/body validation and signed-response validation remain separate read-only diagnostics',()=>{
 assert.match(weddingMailPlanErrorMessage(null,'copy'),/저장 카피의 최신 버전/);
 assert.match(weddingMailPlanErrorMessage(null,'response'),/대상 수 또는 한국시간/);
});
