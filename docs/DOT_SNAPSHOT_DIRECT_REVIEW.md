# 원장 전용 독립 함수 · 로컬 검토용

이 후보는 기존 `bright-function`을 교체하지 않습니다. 새 `dot-snapshot-direct` 함수는 JWT 사용자 확인과 `sanji_members` 소유자 확인 뒤 해당 owner의 스냅샷 조회·미리보기·확정만 제공합니다. `sanji_dot_snapshot`, `sanji_dot_snapshot_head` 읽기와 기존 `sanji_store_dot_snapshot(uuid,jsonb)` 호출만 수행합니다. Gmail, Instagram, 브랜드 발굴, 발송, collector 실행·잠금 경로를 포함하지 않습니다. 화면의 `/dot-snapshot` 요청만 새 함수로 보내며 다른 요청은 기존 서버를 사용합니다.

스냅샷은 사용자가 확인하여 입력하는 집계 자료입니다. exporter 서명 검증이나 자동 전송을 구현하지 않았으며 실시간 수집 연결로 표시하면 안 됩니다. 동일 ID 재전송과 오래된 관찰·세대 차단은 이미 적용된 RPC가 처리합니다. 날짜별 기록은 스냅샷이 있는 최근 30개 날짜를 표시하며 불완전한 지표는 확인 불가로 남깁니다. 인증 토큰·개인 계정·내부 경로는 입력 validator가 거부합니다. 미리보기 해시는 소유자와 정확한 자료 변경을 묶는 UI 확인이며 독립적인 수집 증명 서명은 아닙니다.

## 운영 경계

부모 담당자가 두 테이블의 RLS·직접 권한 및 RPC service_role 전용 실행 권한을 운영에서 확인했다고 전달했습니다. 이 브랜치에는 재실행할 migration이 없으며 `tests/fixtures/dot-snapshot-applied.sql`은 오직 로컬 반복·권한 검사용입니다. 실제 운영 데이터 변경은 하지 않았습니다.

신규 함수 배포는 별도 검토 대상입니다. 같은 프로젝트의 서비스 역할 키는 광범위 DB 권한을 가지므로 완전 보안 격리가 아닙니다. 이 코드가 접근하는 범위와 런타임 공용 Secrets 노출을 함께 검토해야 합니다. 권장 gateway `verify_jwt=true`와 함수 내부 `auth.getUser`·membership 이중 검증, 브라우저 CORS OPTIONS, 미인증 401, 회원 아닌 계정 403은 실제 플랫폼에서 검증이 필요합니다. 새로운 인증정보를 만들지 않습니다. 요청 바디는 300KB에서 스트리밍 중단합니다. 대시보드가 열리거나 사용자가 새로고침할 때만 최대 30개 원장 head와 해당 집계를 조회하며 주기적 폴링, GPT 호출, 외부 제공자 요청은 없습니다.

기존 서버 라우트를 새 이름으로 이전하거나 교체하는 것이 아닙니다. 실제 새 함수 배포와 UI 경로 적용은 사용자 승인 및 배포 도구의 별도 검토 전에 실행하지 않습니다. 검토에 실패하면 다른 경로로 재시도하지 않습니다. 롤백 시 UI 경로를 기존 버전으로 되돌리고 새 함수를 비활성화하며, 이미 저장된 원장 테이블과 데이터는 삭제하지 않습니다.

이 실행기는 실제 exporter 원본 파일에 접근하지 못했습니다. 이전 독립 검토에서 실제 10월 30일·11월 2일 자료를 대조한 validator와 projection은 이번 코드와 바이트가 동일하지만, 신규 HTTP 경로에 대한 실제 자료 재전송 검사는 연결된 담당자가 별도로 수행해야 합니다.

연결 담당자는 실제 exporter JSON을 로컬에 둔 뒤 `node scripts/review-dot-export.cjs <snapshot.json> [snapshot.json ...]`으로 validator·projection을 읽기 전용 비교할 수 있습니다. 이 명령은 외부 요청을 하지 않고 개인 식별자나 파일 경로를 출력하지 않습니다. 날짜·집계·DB audit 유무만 출력합니다.

독립 함수 검토용 단일 파일은 `supabase/dashboard/dot-snapshot-direct.ts`이며 `npm run build:supabase`가 소스에서 재생성합니다. 기존 서버 번들 `public/connect/workspace.ts`는 변경하지 않습니다.
