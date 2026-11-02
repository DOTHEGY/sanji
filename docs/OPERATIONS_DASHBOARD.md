# 운영 현황 데이터 계약

현재 화면은 dot 수집 상태를 직접 읽거나 수집을 시작하지 않습니다. `/operations-dashboard`는 로그인한 산지 소유자의 기존 DB를 읽는 전용 경로입니다. 크리에이터 전체는 recovery 테이블의 소유자별 행 수이고 오늘 신규는 해당 테이블에 한국시간 오늘 생성된 전체 출처의 행 수입니다. 배치 수신·신규·기존은 산지에 실제 저장된 TAGby import batch의 `processed`·`added`·`existing` 합계입니다. 수신 시각의 한국시간을 기준으로 하며 관찰 시각이나 dot 확인 횟수와 다릅니다. 데이터가 없는 날짜를 0으로 채우지 않습니다. 오류나 중복 사전 제외, 확인 횟수, 고유 handle, 일일 목표·남은 수량 및 실행·로그인 상태는 이 테이블에서 알 수 없으므로 미연결로 표시합니다. 5000개 배치 한도에 닿은 경우 수치는 불완전으로 취급합니다.

브랜드의 후보·주소는 기존 `sanji_discovery_history`이며 후보 레코드 수와 법인 고유 수는 다를 수 있습니다. 주소는 최초 확인일의 중복 제거 수로, 유효성이나 소유자 일치 검증의 증거는 아닙니다. Gmail 접수는 확정된 브랜드/제조사/공식 유통사 후보에 연결된 이메일 outbox `accepted` 행 수입니다. Gmail 접수는 수신함 도착 성공이 아닙니다. 예약·처리·확인 필요는 현재 조회된 이메일 jobs의 상태이며 대상이 확인되지 않는 건은 제외하고 따로 알립니다. 반송 주소는 최근 조회된 브랜드 대화에서 `delivery_status`의 영구 오류를 받은 당일 고유 주소이고, 발송건 귀속은 같은 대상·주소·발송 이후 시각과 원본 Message-ID 참조가 모두 맞는 outbox 건수입니다. 미확인이나 0건은 정상 전달 증거가 아닙니다. 최근 30일 outbox/배치 최대 5000건, 미완료·확인 필요 jobs 최대 5000건, 최근 대화 최대 500건을 조회하며 상한에 닿으면 해당 합계는 확인 불가로 표시합니다. 기록은 서버 반환 시점의 스냅샷이며 자동 새로고침하지 않습니다.

## dot 원장 스냅샷 제안 (미구현)

실제 dot 수집 확인 횟수와 일일 잔여는 별도 원장에 있으므로 아래 계약을 인증된 소유자 UI/API로 가져오는 후속 저장 경로가 필요합니다. 이 변경에는 스냅샷을 보관할 DB 구조와 소유자 검증·버전 제어가 필요하며 배포 전에 명시적 검토가 필요합니다. 새 장기 자격증명, collector 잠금 제어 및 비밀값은 필요하지 않습니다. 현재 코드에는 수신 API나 저장소가 없고, 예시 숫자를 운영 화면에 넣지 않습니다.

```json
{
  "schema_version": 1,
  "snapshot_id": "stable-export-id",
  "ledger_generation_id": "stable-ledger-id",
  "revision": 1,
  "day": "YYYY-MM-DD",
  "timezone": "Asia/Seoul",
  "target": null,
  "cap": null,
  "checked_attempts": null,
  "unique_handles": null,
  "new_saved": null,
  "existing_on_import": null,
  "duplicates_preskipped": null,
  "failed_attempts": null,
  "recovered_failures": null,
  "unresolved_failures": null,
  "pending_submissions": null,
  "reserved_remaining": null,
  "available_remaining": null,
  "state": "unavailable",
  "blocker_code": null,
  "state_observed_at": null,
  "source_as_of": null,
  "exported_at": null,
  "server_received_at": null,
  "metrics_quality": {},
  "runs": [{"run_id":"stable-run-id","batch_id":"stable-batch-id"}]
}
```

각 수치는 `complete`·`partial`·`unavailable`과 누락 사유를 함께 전달합니다. `server_received_at`은 서버가 정하고 클라이언트 값을 신뢰하지 않습니다. 날짜·ledger generation·revision과 snapshot ID를 묶어 동일 snapshot 재전송을 멱등 처리하고 낮은 revision이나 이전 세대의 지연 스냅샷은 최신 상태를 덮지 못하게 해야 합니다. 원장의 baseline과 run 범위를 중복 합산하지 않으며, 고유 handle 상세가 없는 baseline은 고유 수를 null/partial로 둡니다. 실패 횟수는 복구 여부와 분리합니다. 상태 관찰 시각이 오래되거나 빠지면 현재 로그인 상태를 추론하지 않습니다. 이 계약은 기록 전달만 다루며 collector 실행·잠금·예약·메일이나 DM 발송을 요청하지 않습니다.

## 운영 적용 경계

이 브랜치의 새 집계 경로는 서버 코드 변경입니다. 현행 운영 Edge v131의 실제 번들과 현재 main을 별도로 대조하고, 변경 범위를 검토해야 합니다. 특히 현재 main에는 운영 서버에 반영되지 않은 Instagram OAuth·수신·답장 관련 PR #24 코드가 들어 있어 `public/connect/workspace.ts` 전체 교체 시 대시보드 외 런타임 경로도 함께 바뀝니다. 이전에 전체 Edge 번들 교체가 자동 승인 검토에서 거부된 사실을 이 변경으로 우회해서는 안 됩니다. DB 마이그레이션은 이 대시보드 코드에 포함하지 않았습니다. 새 소유자별 원장 스냅샷 저장·수신은 별도 설계이며 데이터 저장 구조와 권한에 대한 승인과 검토가 필요합니다.
