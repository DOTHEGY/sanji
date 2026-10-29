# 태그바이 관찰 일괄 기록

인증된 소유자가 크리에이터 찾기에서 JSON을 붙여넣고 미리보기한 뒤 저장합니다. 최대 30행이며 운영자 관찰 기록일 뿐 실시간 API나 발송 기능이 아닙니다. 기존 `sourceAccount`는 수신 크리에이터를 가리키는 기존 필드이며 새 `senderAccount`는 관찰한 발신 계정입니다. 두 필드를 혼동하지 않습니다.

형식 예시(가상의 데이터):

```json
{"rows":[{"creatorId":"aaaaaaaa-aaaa-4aaa-8aaa-000000000001","version":5,"handle":"creator","campaignUrl":"https://tagby.io/campaign/example","sourceAccount":"creator","senderAccount":"sender","observation":{"status":"완료","observedAt":"2026-10-29T00:00:00Z","sourceUrl":"https://tagby.io/campaign/example","body":"관찰한 원문","actualScheduledAt":null},"deliveryCounts":{"success":0,"failed":1,"waiting":0},"failureError":"메시지 발송 여부를 확인할 수 없습니다"}]}
```

`preview`는 인증 소유자의 아이디·버전·캠페인·기존 sourceAccount를 대조해 정규화 행과 해시를 반환합니다. `commit`은 같은 원본 rows와 미리보기 hash를 받아 다시 대조하고 DB 트랜잭션에서 모든 행의 버전을 잠가 검증합니다. 하나라도 변경되면 전체 롤백합니다. 이전 관찰은 이력으로 보존하고 기존 이메일·DM 원문, 예정시각, 외부 Gmail 관찰, 발송 대기열을 수정하지 않습니다. `발송 여부 확인 불가`는 전송 불명이며 계정 미발견은 실패입니다. 집계만으로 수신자 성공을 추정하지 않습니다.
