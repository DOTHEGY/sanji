# 크리에이터 연락 검토 화면 반영

이 기능은 이메일·DM 검토 자료만 저장한다. 브랜드 테이블·메일 작업 대기열을 변경하거나 태그바이 API·발송을 호출하지 않는다. 사용자가 선택한 이메일·DM 시각은 `plannedAt`으로만 저장하고, 태그바이에서 실제 관찰한 상태·실제 예약 시각은 별도 `observation`에 출처 URL과 확인 시각을 남긴다. 실제 예약 여부를 추정하지 않는다.

마이그레이션 `202610290001_creator_contact_review.sql`은 owner별 RLS가 적용된 검토 테이블 및 서비스 역할만 실행하는 일괄 가져오기·추천 날짜 이동 함수를 추가한다. 기존 추천의 28일 30명 ID를 29일로 옮길 때 기존 `created`는 보존한다. 이동 함수는 정확히 30개 서로 다른 ID, 소유자, 원래 날짜 30건, 대상 날짜 비어 있음, 날짜를 모두 검사하고 다른 추천은 만들지 않는다. 먼저 대상 이력 백업과 일치를 확인한다. 이미 옮겨진 경우 중복 생성하지 않고 오류로 중단한다.

운영 순서: 마이그레이션과 RLS/실행 권한을 확인하고 Edge 함수에 단일 번들을 배포한다. 기존 30명의 정확한 handles 및 날짜·캠페인 순서를 확인하고 별도로 승인된 이력 이동 함수를 호출한다. 그 후 인증된 사용자 화면의 크리에이터 찾기 > 크리에이터 검토 자료 가져오기 또는 `/creator-contact-review/import`로 실제 관찰한 데이터만 1~30개씩 추가한다. 신규 자료는 기존에 저장된 검토 내용이 있으면 전체 배치를 중단하여 덮어쓰지 않는다. Pages는 서버 준비가 끝난 뒤 배포한다. 백업은 마이그레이션 전 기존 함수·추천 이력, import 전 기존 검토 내용을 보관한다. 롤백 시 이력의 실제 이전값만 복구하고 검토 자료는 삭제하지 않는다.

입력 JSON `rows` 예시(아래는 형식 설명용, 실제 내용 아님):
```json
{"rows":[{"handle":"creator_example","data":{"email":{"address":"","sourceUrl":"","subject":"","body":"","plannedAt":"2026-10-29T00:00:00Z","status":"not_prepared"},"dm":{"body":"","plannedAt":"2026-10-28T21:00:00Z","status":"planned","campaignUrl":"https://tagby.io/campaign/example","sourceAccount":"creator_example","observation":{"status":"발송 전","observedAt":"2026-10-28T00:00:00Z","sourceUrl":"https://tagby.io/campaign/example","actualScheduledAt":null,"body":""}}}}]}
```

순서 `i`(0~29)의 DM 검토 예정 시각은 `2026-10-28T21:00:00Z + i×30분`이고 마지막은 `2026-10-29T11:30:00Z`(20:30 KST)다. 이메일 예정은 29일 09:00 KST이며 주소가 없으면 주소를 비운다. 공개 이메일을 입력할 경우 해당 Instagram 프로필을 `sourceUrl`로 기록한다. 캠페인에서 실제로 본 문구와 시각만 `observation`에 저장하며 실제 예약이 없으면 `actualScheduledAt`을 비운다. 이름·상품·날짜를 임의로 생성하거나 원문을 변경하지 않는다. 이메일·DM 상태는 서로 독립이며 발송·예약 버튼은 없다.
