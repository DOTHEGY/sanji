# Instagram 공식 수신·수동 답장 독립 서비스 (로컬 검토용)

기존 `bright-function`을 배포하거나 교체하지 않습니다. 새 `instagram-inbox` 함수는 소유자가 로그인한 경우에만 `@valu_est` 연결 시작·완료, 상태 확인, 저장된 수신함, 수동 동기화, 수동 답장을 제공합니다. 웹훅·자동 수신·예약·대량 발송·선제 DM·Gmail 경로가 없습니다. 공개 callback은 state/code만 프런트 fragment로 전달하고 인증된 완료 요청에서 원래 owner, provider, 기한 및 1회 소비를 확인합니다. 정상 계정·장기 토큰 검증 후에만 기존 암호화 저장소에 보관하며 다른 계정이나 단기 토큰은 거부합니다.

수동 동기화는 Meta 대화를 한 번에 1개씩 가져오고 메시지 상세는 요청당 최대 5개씩 처리합니다. Meta 조회는 요청당 최대 7회이고 각 호출의 제한 시간은 3.5초입니다. 처리 중 바뀐 메시지 순서는 다시 처음부터 확인하도록 막으며, 저장된 메시지는 중복 저장하지 않습니다. 제공된 opaque cursor만 이용해 다음 페이지를 요청합니다. 공급자 `paging.next` URL을 방문하지 않습니다. 메시지 상세는 대화당 최근 20개까지 조회하며, 본문이 없으면 확인 불가로 표시합니다. 새로 수집·저장할 수 있는 수신은 90일 이내로 제한하며 기존 저장분은 삭제하지 않고, 목록은 500개씩 나눕니다. 수동 동기화는 자동 작업이 아니며 provider 제한으로 30일간 비활성인 요청함 대화와 오래된 메시지는 빠질 수 있습니다. 편집 중에는 동기화 후 화면을 덮지 않습니다.

답장은 현재 인증된 owner와 `@valu_est` 및 실제 수신자를 DB와 대조하고, 최근 24시간 내 수신 메시지에 대해 사용자가 본문·수신자를 확인한 뒤에만 수행합니다. 기본 서버 설정 `INSTAGRAM_DIRECT_REPLY_ENABLED`는 꺼짐입니다. 중복 요청과 응답 불명확 건은 자동 재전송하지 않습니다. 기존 `INSTAGRAM_SENDING_ENABLED`와 Gmail/브랜드 설정을 바꾸지 않습니다.

## 실제 적용 전 별도 검토

* 운영 DB에 `sanji_instagram_inbound`, `sanji_instagram_reply_attempts`와 `sanji_instagram_capture`, `sanji_instagram_reserve_reply`, `sanji_instagram_finish_reply`가 있는지 읽기 확인합니다. 미존재 시 기존 `202610300004_creator_instagram_inbox.sql`의 두 테이블 RLS, public/anon/authenticated 권한 회수, service_role SELECT 및 service_role 전용 security-definer RPC를 정확히 검토합니다. 이미 있는 경우 무조건 재실행하지 않습니다. 기존 기본 권한 때문에 service_role에 직접 쓰기가 남아 있을 수 있으므로 읽기 검증 후 필요한 경우에만 `202611020002_instagram_direct_acl.sql`로 직접 권한을 회수하고 SELECT 및 RPC 실행만 남깁니다. 이 SQL 역시 검토 전 적용하지 않습니다.
* 인증 흐름은 기존 `sanji_members`, `sanji_oauth_states`, `sanji_connections`, `sanji_audit`를 재사용합니다. 새 함수는 같은 프로젝트의 service-role과 공용 Secrets에 접근할 수 있으므로 완전한 보안 격리가 아닙니다. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET`, `APP_ORIGIN`, `APP_FRONTEND_URL`, 선택적 `META_GRAPH_VERSION`, 기본 꺼진 `INSTAGRAM_DIRECT_REPLY_ENABLED`의 존재·범위만 점검하고 값을 출력하지 않습니다.
* Meta 앱에 `https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/instagram-inbox/oauth/instagram/callback`을 등록해야 합니다. 이 설정 변경은 별도 승인·검토 대상입니다. 사용자는 Meta 공식 화면에서 `@valu_est`, `instagram_business_basic`, `instagram_business_manage_messages`를 직접 확인하고 승인합니다. 앱의 실제 승인·심사 상태는 아직 미확인입니다.
* 공개 OAuth callback 때문에 새 함수는 gateway JWT 검증을 끄는 구성이 필요하지만, callback/health 외 모든 경로에서 Supabase `getUser`와 멤버십을 직접 검사합니다. CORS, callback 경계, 서비스 역할 접근 범위, 토큰 암호화, 정책 및 provider API를 독립 보안 검토해야 합니다. 새 함수·DB·환경설정 적용은 자동 승인된 것으로 간주하지 않습니다.
* 배포 순서는 DB와 권한의 읽기 점검 및 필요 변경 검토 → 새 함수만 배포(답장 gate OFF) → 화면 경로 배포 → 사용자 공식 로그인·권한 승인 → 사용자 확인을 거친 gate 활성화입니다. 실제 상대에게 테스트 메시지를 보내지 않습니다.
* 롤백은 별도 gate를 끄고 화면의 Instagram 경로를 기존 버전으로 되돌립니다. 기존 bright-function과 메일은 유지합니다. 저장된 수신·답장 기록은 보존하고 별도 승인 없이 삭제하지 않습니다.

Meta 공식 참고: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/ 및 https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/ .
