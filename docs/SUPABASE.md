# Supabase 운영 연결

프로젝트: `ofasbfpeapbdcotnptvz`. 공개 URL과 publishable key만 웹 번들에 포함됩니다. 관리자 이메일·비밀번호·service_role/secret key는 공개 코드에 넣지 않습니다.

## 현재 확인

- 제공한 publishable key로 `/auth/v1/settings` HTTP 200, 이메일 인증 사용 가능을 확인했습니다.
- `sanji_members` 테이블은 아직 없어서 DB 생성이 필요합니다(PGRST205). 공개 키는 SQL 실행·함수 배포 권한을 주지 않습니다.
- 운영 로그인 URL: https://dothegy.github.io/sanji/workspace/
- 운영 자료는 Supabase Postgres에 저장합니다. 가상 데이터는 초기화하지 않습니다. 인증+관리자 멤버십+RLS를 모두 통과해야 읽을 수 있습니다.
- SQL은 PostgreSQL 엔진(PGlite)에서 실행·재실행·관리자 권한·RLS·버전 이력·중복·발송 예약을 테스트했습니다. 실제 프로젝트에 적용된 것은 아닙니다.

## 1. 관리자 계정과 DB 만들기 (Dashboard)

1. https://supabase.com/dashboard/project/ofasbfpeapbdcotnptvz/auth/users 에서 Add user → Create new user. 본인 관리자 이메일과 **이 서비스용 새 비밀번호**를 입력합니다. Gmail 비밀번호를 입력하지 마세요. 대시보드의 Auto Confirm 옵션은 프로젝트 관리자가 본인 계정을 직접 생성하는 경우에 사용합니다.
2. 권장: https://dothegy.github.io/sanji/setup/ 에서 1→2→3단계 전체 복사 버튼을 사용해 SQL Editor의 새 쿼리로 각각 실행하세요. 각 SQL의 마지막 COMPLETE 주석까지 붙었는지 확인하고 선택 영역 없이 실행합니다. 원본을 사용할 경우 https://supabase.com/dashboard/project/ofasbfpeapbdcotnptvz/sql/new 에서 `supabase/migrations/202610210001_workspace.sql` 전체를 실행합니다. 다른 기존 테이블은 수정하지 않으며 `sanji_` 접두사의 새 구조와 비공개 첨부 버킷을 생성합니다.
3. `supabase/OWNER.template.sql`의 `YOUR_ADMIN_EMAIL`을 1번 이메일로 바꿔 실행합니다. 마지막 조회에서 해당 계정이 표시되는지 확인하세요. SQL은 관리자 권한으로만 실행합니다. 관리자 이메일과 실제 업무 자료를 공개 저장소에 커밋하지 마세요.
4. 위 운영 URL에서 로그인합니다. 후보·상품·템플릿·일정·대화 관리 정보는 브라우저 임시 저장이 아니라 Supabase에 저장됩니다. 비밀번호 재설정/계정 초대 UI는 아직 제공하지 않습니다.

RLS: 브라우저는 자기 소유 자료만 조회하며, 일반 저장은 검증 RPC를 통해서만 가능합니다. 다른 프로젝트 Auth 사용자가 있어도 sanji_members에 등록되지 않으면 이 앱 자료에 접근할 수 없습니다. 저장 함수는 optimistic version을 검사하고 기존 거래 조건을 history에 보존합니다.

## 2. Edge Function 배포 (메일·검색·DM 연동)

브랜드·상품·템플릿 저장은 SQL 적용만으로 사용할 수 있습니다. 이메일 발송, Gmail 동기화, API 검색, 수동 DM 결과 기록, Instagram 웹훅은 Edge Function이 필요합니다. 함수가 없으면 미연동으로 안내하며 성공 상태를 만들지 않습니다.

CLI를 사용할 경우:

```sh
npx supabase login
npx supabase link --project-ref ofasbfpeapbdcotnptvz
npx supabase db push
npx supabase functions deploy workspace --no-verify-jwt
```

Dashboard에서 이미 SQL을 적용했다면 CLI의 db push는 생략하세요. 함수는 config.toml에 따라 JWT gateway 검증을 비활성화하지만 **함수 내부에서 Supabase Auth getUser와 멤버십을 매 요청 검증**합니다. 공개 OAuth callback은 일회성 state+PKCE(Google), Meta 웹훅은 HMAC 서명을 검증합니다. publishable key를 JWT로 오인하지 않도록 구성한 것입니다.

CLI 없이도 Dashboard → Edge Functions → Deploy a new function → Via Editor에서 `workspace` 이름으로 생성하고 `supabase/dashboard/workspace.ts` 전체 내용을 붙여넣어 배포할 수 있습니다. 이 파일은 로컬 schema import까지 포함한 단일 파일입니다. Function 설정의 legacy JWT verification은 꺼야 하며, 앱 코드의 인증 검사는 제거하지 마세요.

Edge Function의 Secrets에 다음을 입력합니다(채팅이나 GitHub에 비밀 값을 올리지 마세요).

| 이름 | 용도 |
|---|---|
| APP_ORIGIN | `https://dothegy.github.io` |
| APP_FRONTEND_URL | `https://dothegy.github.io/sanji/workspace/` |
| TOKEN_ENCRYPTION_KEY | 별도 생성한 32바이트 이상 강한 임의 문자열, OAuth 토큰 AES-GCM 암호화에 사용. 유지·백업 필요 |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Google Cloud의 Gmail OAuth 웹앱 |
| EMAIL_SENDING_ENABLED | 초기 `false`, 실제 발송 별도 승인 후에만 `true` |
| INSTAGRAM_SENDING_ENABLED | 초기 `false`, 실제 회신 승인 후에만 `true` |
| BRAVE_SEARCH_API_KEY | 선택, 실제 웹 검색 API |
| META_APP_ID / META_APP_SECRET / META_VERIFY_TOKEN | 선택, 공식 Instagram 연결·웹훅 |
| META_GRAPH_VERSION | 기본 v24.0, 실제 Meta 앱 지원 버전 확인 |

SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY는 Edge runtime의 기본 서버 환경에서 사용합니다. 브라우저·공개 번들에 복사하지 마세요. DB에는 암호화된 OAuth 토큰과 비밀이 없는 연결 요약을 분리 저장합니다. 연결 상태 조회 RPC는 요약만 반환합니다.

## 3. Gmail 실제 연결

Google Cloud에서 Gmail API를 켜고 OAuth 동의 화면·웹 애플리케이션 클라이언트를 만듭니다. 승인된 리디렉션 URI:

`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/workspace/oauth/gmail/callback`

권한은 gmail.send / gmail.readonly입니다. 외부 테스트 앱은 본인 Gmail을 테스트 사용자로 추가해야 하며 외부 운영 공개에는 Google 검증·경우에 따른 제한 범위 보안 평가가 필요합니다. 테스트 토큰 수명·쿼터는 계정 설정에 따라 확인하세요. 연결 설정의 Google 공식 로그인 버튼으로 인증합니다. 이 앱의 로그인과 Gmail OAuth는 별도입니다.

발송 전: 발신자 정보 저장 → 공식 연락처/소유 회사/출처/확인일 검증 → 카피·상품 선택 → 최종 미리보기 → 개별 승인. 서버 발송 스위치는 처음 꺼져 있습니다. 광고성 이메일은 `(광고)` 제목과 발신자·수신 거부 안내를 포함하고 한국시간 08~21시 외에는 차단합니다. 동의·적용 예외 및 식품 광고 기준은 운영자가 확인해야 하며 코드만으로 합법성을 보장하지 않습니다.

동기화는 등록한 이메일 대상으로 최근 90일·최대 30명·대상당 대화 20개를 수집합니다. Edge 실행 제한 때문에 많은 대화가 있으면 일부만 처리될 수 있습니다. 메일 원본 첨부 다운로드·백그라운드 Gmail push·대규모 큐는 미구현입니다. 자동 응답은 헤더를 참고해 구분하되 검토가 필요합니다. 명시적 수신 거부는 차단 목록에 저장합니다. 접수는 받은편지함 도착/열람이 아닙니다. 불확실한 결과는 자동 재시도하지 않습니다.

## 4. Instagram

리디렉션 URI:
`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/workspace/oauth/instagram/callback`

웹훅:
`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/workspace/instagram/webhook`

프로페셔널 계정, instagram_business_basic / instagram_business_manage_messages 및 적용되는 심사·Advanced Access가 필요합니다. 상대가 시작한 대화만 수신하고, 후보와 계정의 관계를 사용자가 직접 확인해 연결한 후 24시간 이내 텍스트 회신을 지원합니다. 신규 선제 DM은 문구 복사·프로필 열기·직접 발송 후 결과 기록입니다. 임의 계정 로그인·무단 대량 DM은 구현하지 않습니다. 토큰 자동 갱신·과거 전체 대화 가져오기·DM 첨부는 미구현입니다.

## 한계와 비용

현재 공개 키 연결·프런트 번들·SQL/함수 코드·로컬 테스트까지만 완료했고, 프로젝트 SQL/관리자 계정/Edge Functions 적용 및 실제 Gmail·Meta 계정 송수신은 미완료입니다. 새 키를 받았다는 이유로 관리 권한이 있다고 가정하지 않습니다. 실제 운영 검증은 사용자 설정 후 재개해야 합니다.

Supabase 무료 플랜 범위에서 시작할 수 있으나 DB·Storage·Auth 이메일 발송 제한·Edge 시간/호출/네트워크 한도·프로젝트 일시중지 조건과 최신 가격을 직접 확인해야 합니다. 이메일 계정/Google 검증/검색 공급자 비용은 별도입니다. 결제·계정 연결·실제 발송을 자동으로 진행하지 않았습니다. 무료라는 이유로 영구 무제한 운영을 보장하지 않습니다.

SQL은 프로젝트 관리자만 실행합니다. 실제 회사 목록·연락처·대화·협상 가격은 Auth+멤버십 뒤에서만 조회합니다. API 공개 키는 본래 공개용이며 비밀 접근 통제를 대신하지 않습니다. PostgreSQL DB 전체 암호화를 앱에서 구현한 것은 아니며 호스팅의 저장 암호화·백업 정책을 확인해야 합니다. OAuth 토큰은 별도로 AES-GCM 암호화합니다.
