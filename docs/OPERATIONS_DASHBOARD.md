# 운영 현황 데이터 계약

현재 화면은 dot 수집 상태를 직접 읽거나 수집을 시작하지 않습니다. `/operations-dashboard`는 로그인한 산지 소유자의 기존 DB를 읽는 전용 경로입니다. 크리에이터 전체는 recovery 테이블의 소유자별 행 수이고 오늘 신규는 해당 테이블에 한국시간 오늘 생성된 전체 출처의 행 수입니다. 배치 수신·신규·기존은 산지에 실제 저장된 TAGby import batch의 `processed`·`added`·`existing` 합계입니다. 수신 시각의 한국시간을 기준으로 하며 관찰 시각이나 dot 확인 횟수와 다릅니다. 데이터가 없는 날짜를 0으로 채우지 않습니다. 오류나 중복 사전 제외, 확인 횟수, 고유 handle, 일일 목표·남은 수량 및 실행·로그인 상태는 이 테이블에서 알 수 없으므로 미연결로 표시합니다. 5000개 배치 한도에 닿은 경우 수치는 불완전으로 취급합니다.

브랜드의 후보·주소는 기존 `sanji_discovery_history`이며 후보 레코드 수와 법인 고유 수는 다를 수 있습니다. 주소는 최초 확인일의 중복 제거 수로, 유효성이나 소유자 일치 검증의 증거는 아닙니다. Gmail 접수는 확정된 브랜드/제조사/공식 유통사 후보에 연결된 이메일 outbox `accepted` 행 수이며 크리에이터 제안 유형을 제외합니다. Gmail 접수는 수신함 도착 성공이 아닙니다. 예약·처리·확인 필요는 현재 조회된 이메일 jobs의 상태이며 대상이 확인되지 않는 건은 제외하고 따로 알립니다. 반송 주소는 최근 조회된 브랜드 대화에서 `delivery_status`의 영구 오류를 받은 당일 고유 주소이고, 발송건 귀속은 같은 대상·주소·발송 이후 시각과 원본 Message-ID 참조가 모두 맞는 outbox 건수입니다. 미확인이나 0건은 정상 전달 증거가 아닙니다. 최근 30일 outbox/배치 최대 5000건, 미완료·확인 필요 jobs 최대 5000건, 최근 대화 최대 500건을 조회하며 상한에 닿으면 해당 합계는 확인 불가로 표시합니다. 기록은 서버 반환 시점의 스냅샷이며 자동 새로고침하지 않습니다.

## dot 원장 스냅샷 전달과 저장 (운영 미적용)

실제 dot 수집 확인 횟수와 일일 잔여는 별도 원장에 있으므로 아래 계약을 인증된 소유자 UI/API로 가져오는 후속 저장 경로가 필요합니다. 이 변경에는 스냅샷을 보관할 DB 구조와 소유자 검증·버전 제어가 필요하며 배포 전에 명시적 검토가 필요합니다. 새 장기 자격증명, collector 잠금 제어 및 비밀값은 필요하지 않습니다. 이 별도 브랜치는 수신 API와 저장 마이그레이션을 준비하지만 운영에 적용하지 않았으며, 예시 숫자를 운영 화면에 넣지 않습니다.

```json
{
  "schema_version": "sanji.collection.snapshot.v1",
  "snapshot_id": "stable-export-id", "ledger_generation_id": "stable-ledger-id",
  "revision": "content-hash", "day": "YYYY-MM-DD", "timezone": "Asia/Seoul",
  "source_as_of": "2026-11-02T04:00:00Z", "last_profile_observed_at": null,
  "exported_at": "2026-11-02T04:01:00Z", "sources": [],
  "metrics": {"target":null,"checked_attempts":null,"unique_handles":null,"known_unique_handles":null,"new_saved":null,"existing_on_import":null,"duplicates_preskipped":null,"failed_attempts":null,"recovered_failures":null,"unresolved_failures":null,"pending_submissions":null,"reserved_remaining":null,"available_remaining":null,"usage_cost":null},
  "coverage": {}, "execution": {}, "login": {}, "database_audit": {}, "warnings": [], "runs": []
}
```

위 수치와 날짜는 계약 검수용 예시입니다. 지표는 해당 coverage 그룹이 `complete`로 확인된 경우에만 숫자로 표시합니다. `checked_attempts` 그룹은 확인 횟수·목표·제출 대기·예약·잔여, `unique_handles` 그룹은 고유 수, `outcomes` 그룹은 신규·기존·사전 중복·실패·복구 수, `usage_cost` 그룹은 비용에 적용합니다. 그룹 값은 `complete` 문자열 또는 `status`/`quality`가 `complete`인 객체를 지원합니다. 그 외에는 저장된 값이 있어도 확인 불가로 표시하며, source_as_of나 로그인 확인이 15분보다 오래되면 현재 상태를 추정하지 않습니다. 서버는 수신 시각을 별도로 기록합니다.


각 수치는 `complete`·`partial`·`unavailable`과 누락 사유를 함께 전달합니다. `server_received_at`은 서버가 정하고 클라이언트 값을 신뢰하지 않습니다. 날짜·ledger generation·revision과 snapshot ID를 묶어 동일 snapshot 재전송을 멱등 처리하고 낮은 revision이나 이전 세대의 지연 스냅샷은 최신 상태를 덮지 못하게 해야 합니다. 원장의 baseline과 run 범위를 중복 합산하지 않으며, 고유 handle 상세가 없는 baseline은 고유 수를 null/partial로 둡니다. 실패 횟수는 복구 여부와 분리합니다. 상태 관찰 시각이 오래되거나 빠지면 현재 로그인 상태를 추론하지 않습니다. 이 계약은 기록 전달만 다루며 collector 실행·잠금·예약·메일이나 DM 발송을 요청하지 않습니다.

## 운영 적용 경계

이 브랜치는 운영 v131을 기준으로 한 별도 대시보드 축소 후보 PR #29 위에 원장 수신을 추가합니다. 번들 입력에서 기존 미배포 Instagram OAuth·DM 모듈은 제외했습니다. 실제 운영 서버와 기준본을 별도로 대조하고 독립 검토를 완료하기 전에는 배포나 병합하지 않습니다. 원장 저장을 위한 두 테이블·RLS·service_role 권한과 저장 RPC는 별도 보안 범위 승인이 필요합니다. 이미 거절된 전체 번들 교체를 우회하는 배포는 하지 않습니다.

## 화면 검수 미리보기

다음 이미지는 **모의 데이터**로 만든 정적 검수 화면이며 운영 실적이 아닙니다. 실제 화면은 로그인한 소유자의 서버 집계를 요청합니다.

- [데스크톱 미리보기](previews/operations-dashboard-desktop.png)
- [모바일 미리보기](previews/operations-dashboard-mobile.png)
- [통합 대화함 데스크톱 미리보기](previews/inbox-compact-desktop.png)
- [통합 대화함 모바일 미리보기](previews/inbox-compact-mobile.png)

## dot 스냅샷 수신 작업 (별도 변경, 운영 미적용)

인증된 소유자가 dot exporter의 `sanji.collection.snapshot.v1` 집계 JSON을 미리보기한 뒤 저장합니다. `revision`은 숫자 순서가 아니라 내용 해시이므로 순서 판단에 사용하지 않습니다. `source_as_of`는 원장 관찰 시각, `exported_at`은 내보낸 시각, `received_at`은 서버 저장 시각으로 각각 보관합니다. 동일 snapshot ID와 원장 내용은 `exported_at`만 다른 재내보내기를 포함해 멱등 처리하며 첫 수신 기록을 보존합니다. 다른 필드가 달라지면 ID 재사용을 거부합니다. 동일 세대에서 관찰 시각이 이전인 자료는 거부합니다. 관찰 시각이 같은 보완 자료는 내보내기 시각이 더 늦을 때만 받고, 기존 로그인·DB 확인 시각이나 coverage 품질을 이전 상태로 되돌리지 못하게 합니다. 이는 exporter의 내보내기 시각 순서가 정확하다는 전제이며, 내용 해시인 revision을 시간 순서로 해석하지 않습니다. 이미 나타났던 이전 세대로 되돌아갈 수 없고 세대가 바뀌면 새 관찰 시각이 이전보다 늦어야 합니다. 각 날짜와 소유자에 대한 변경은 DB 트랜잭션 및 advisory lock으로 직렬화합니다.

운영 적용 시 새 테이블 `sanji_dot_snapshot`, `sanji_dot_snapshot_head`, `security definer` 함수 `sanji_store_dot_snapshot(uuid,jsonb)`가 필요합니다. 테이블에 RLS를 적용하고 anon/authenticated 권한은 부여하지 않으며 service_role을 포함한 기존 테이블 직접 권한을 명시적으로 회수한 뒤 service_role에 SELECT와 저장 함수 실행만 허용합니다. 함수는 멤버 여부를 재검증하고 소유자를 인증된 API에서 전달받습니다. DB 구조와 함수 권한 적용은 별도 승인과 보안 검토가 필요합니다. collector 계정·자격증명·잠금 또는 실행 설정은 전달하거나 변경하지 않습니다. 스냅샷의 새 저장 수는 DB 실제 신규 저장 수와 별도로 취급합니다. 이 변경은 아직 운영에 적용되지 않았습니다.

독립 검토에서 실제 dot exporter의 10월 30일·11월 2일 비식별 출력으로 validator와 수치 projection을 대조했습니다. 부분 고유 수와 빈 DB audit, 로그인 대기·오래된 상태도 확인했습니다. SQL 실행과 권한 테스트는 이 브랜치의 로컬 PGlite 검사에서 수행했으며 독립 검토자가 별도로 SQL을 실행한 것은 아닙니다. 이 검증은 운영 적용이나 자료 전송을 뜻하지 않습니다.
