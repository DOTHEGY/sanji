# Supabase 운영 연결

프로젝트: `ofasbfpeapbdcotnptvz`. 공개 URL과 publishable key만 웹 번들에 포함됩니다. 관리자 이메일·비밀번호·service_role/secret key는 공개 코드에 넣지 않습니다.

## 현재 확인

- 제공한 publishable key로 `/auth/v1/settings` HTTP 200, 이메일 인증 사용 가능을 확인했습니다.
- 최근 진단에서 `sanji_members` 테이블 존재(메타데이터 HTTP 200)를 확인했습니다. 개별 계정의 멤버십이나 로그인 성공을 확인한 것은 아닙니다. 추가 예약 테이블 sanji_jobs는 미생성(PGRST205)이었습니다. 이후 실제 배포 이름이 bright-function임을 확인해 앱 주소를 수정했습니다. 공개 키는 SQL 실행·함수 배포 권한을 주지 않습니다.
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
npx supabase functions deploy bright-function --no-verify-jwt
```

Dashboard에서 이미 SQL을 적용했다면 CLI의 db push는 생략하세요. 함수는 config.toml에 따라 JWT gateway 검증을 비활성화하지만 **함수 내부에서 Supabase Auth getUser와 멤버십을 매 요청 검증**합니다. 공개 OAuth callback은 일회성 state+PKCE(Google), Meta 웹훅은 HMAC 서명을 검증합니다. publishable key를 JWT로 오인하지 않도록 구성한 것입니다.

Dashboard → Edge Functions에서 기존 `bright-function`을 선택한 뒤 Code / Edit code에서 `supabase/dashboard/workspace.ts` 전체 내용을 붙여넣어 같은 함수를 업데이트할 수 있습니다. 코드 파일명은 workspace.ts여도 배포 함수명은 bright-function으로 유지합니다. 이 파일은 로컬 schema import까지 포함한 단일 파일입니다. Function 설정의 legacy JWT verification은 꺼야 하며, 앱 코드의 인증 검사는 제거하지 마세요.

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

`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function/oauth/gmail/callback`

권한은 gmail.send / gmail.readonly입니다. 외부 테스트 앱은 본인 Gmail을 테스트 사용자로 추가해야 하며 외부 운영 공개에는 Google 검증·경우에 따른 제한 범위 보안 평가가 필요합니다. 테스트 토큰 수명·쿼터는 계정 설정에 따라 확인하세요. 연결 설정의 Google 공식 로그인 버튼으로 인증합니다. 이 앱의 로그인과 Gmail OAuth는 별도입니다.

발송 전: 발신자 정보 저장 → 공식 연락처/소유 회사/출처/확인일 검증 → 카피·상품 선택 → 최종 미리보기 → 개별 승인. 서버 발송 스위치는 처음 꺼져 있습니다. 광고성 이메일은 `(광고)` 제목과 발신자·수신 거부 안내를 포함하고 한국시간 08~21시 외에는 차단합니다. 동의·적용 예외 및 식품 광고 기준은 운영자가 확인해야 하며 코드만으로 합법성을 보장하지 않습니다.

동기화는 등록한 이메일 대상으로 최근 90일·최대 30명·대상당 대화 20개를 수집합니다. Edge 실행 제한 때문에 많은 대화가 있으면 일부만 처리될 수 있습니다. 메일 원본 첨부 다운로드·백그라운드 Gmail push·대규모 큐는 미구현입니다. 자동 응답은 헤더를 참고해 구분하되 검토가 필요합니다. 명시적 수신 거부는 차단 목록에 저장합니다. 접수는 받은편지함 도착/열람이 아닙니다. 불확실한 결과는 자동 재시도하지 않습니다.

## 4. Instagram

리디렉션 URI:
`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function/oauth/instagram/callback`

웹훅:
`https://ofasbfpeapbdcotnptvz.supabase.co/functions/v1/bright-function/instagram/webhook`

프로페셔널 계정, instagram_business_basic / instagram_business_manage_messages 및 적용되는 심사·Advanced Access가 필요합니다. 상대가 시작한 대화만 수신하고, 후보와 계정의 관계를 사용자가 직접 확인해 연결한 후 24시간 이내 텍스트 회신을 지원합니다. 신규 선제 DM은 문구 복사·프로필 열기·직접 발송 후 결과 기록입니다. 임의 계정 로그인·무단 대량 DM은 구현하지 않습니다. 토큰 자동 갱신·과거 전체 대화 가져오기·DM 첨부는 미구현입니다.

## 한계와 비용

현재 공개 키 연결·프런트 번들·SQL/함수 코드·로컬 테스트까지만 완료했고, 프로젝트 SQL/관리자 계정/Edge Functions 적용 및 실제 Gmail·Meta 계정 송수신은 미완료입니다. 새 키를 받았다는 이유로 관리 권한이 있다고 가정하지 않습니다. 실제 운영 검증은 사용자 설정 후 재개해야 합니다.

Supabase 무료 플랜 범위에서 시작할 수 있으나 DB·Storage·Auth 이메일 발송 제한·Edge 시간/호출/네트워크 한도·프로젝트 일시중지 조건과 최신 가격을 직접 확인해야 합니다. 이메일 계정/Google 검증/검색 공급자 비용은 별도입니다. 결제·계정 연결·실제 발송을 자동으로 진행하지 않았습니다. 무료라는 이유로 영구 무제한 운영을 보장하지 않습니다.

SQL은 프로젝트 관리자만 실행합니다. 실제 회사 목록·연락처·대화·협상 가격은 Auth+멤버십 뒤에서만 조회합니다. API 공개 키는 본래 공개용이며 비밀 접근 통제를 대신하지 않습니다. PostgreSQL DB 전체 암호화를 앱에서 구현한 것은 아니며 호스팅의 저장 암호화·백업 정책을 확인해야 합니다. OAuth 토큰은 별도로 AES-GCM 암호화합니다.

## 서버 연결 오류·카피·예약 자동 발송 (추가 기능)

실제 배포된 함수 이름은 `bright-function`입니다. 이전 앱 주소는 workspace였고, 이전 함수 코드도 workspace라는 이름을 고정해 서로 연결되지 않았습니다. 최신 코드는 배포 함수 이름을 자동으로 해석하며 상태 확인은 버전 3을 반환합니다. 같은 bright-function의 코드만 최신 버전으로 교체하세요. 공개 키로 이 함수를 배포할 수는 없습니다. https://dothegy.github.io/sanji/connect/ 에서 단일 파일 전체 복사, Dashboard 배포, Secrets, 예약 SQL과 Cron 설정을 진행하세요. 이 페이지에는 실제 시크릿이 들어 있지 않습니다. 인증된 화면의 연동 설정에서도 같은 안내를 열 수 있습니다.

### 카피 입력과 AI 도입부

운영 화면 → 템플릿 → 템플릿 추가 → **공통 본문 카피 · AI 수정 없음**에 사용자가 카피를 입력합니다. 제목·본문·서명을 저장합니다. 템플릿의 사용 → 수신자 선택 → **AI 도입부 1~2줄 생성**을 누르면 개인화 도입부 칸만 채웁니다. 공통 본문은 바꾸지 않습니다. 최종 이메일은 도입부 + 공통 본문 + 서명/발신자 정보 순서입니다. 기존 변수 치환은 사용자가 입력한 변수에만 적용합니다.

후보에 출처 URL·확인일·설명이 있는 공개 콘텐츠 근거가 있어야 AI 생성이 가능합니다. 내부 메모·연락처·팔로워 수치·협상 조건은 모델 입력에서 제외합니다. AI는 공개 콘텐츠 근거를 받으며 병력·개인 건강·질환을 추정하지 않도록 지시하고 위험 표현·근거 누락은 차단합니다. 이는 사실 검증을 보장하지 않으므로 생성된 문구와 근거를 직접 검토해야 합니다. 근거가 없으면 문구를 지어내는 대신 생성하지 않습니다.

Edge Secrets에 **AI_API_KEY** (OpenAI API 키), 선택적으로 **AI_MODEL** (기본 gpt-4.1-mini)을 설정합니다. API 비용·한도는 사용자 계정에서 별도로 확인해야 하며, 에이전트는 유료 요청을 실행하지 않았습니다. 브라우저의 AI 생성 버튼을 누를 때만 호출하고 시간당 사용자 요청 20회 한도를 둡니다. AI가 발송 승인이나 최종 본문을 대신 결정하지 않습니다. 키는 채팅이나 앱의 카피 입력칸에 넣지 않습니다.

### 승인한 이메일의 예약 자동 발송

추가 SQL `supabase/migrations/202610210002_automation.sql`을 적용합니다. 기존 설치 1~3단계를 다시 실행할 필요는 없습니다. 연결 안내에서 추가 SQL 전체 복사 버튼을 제공합니다.

Gmail OAuth 연결과 실제 발송 별도 승인 후 EMAIL_SENDING_ENABLED=true가 되어야 예약을 등록할 수 있습니다. 제안 작성 → 최종 미리보기 → 수신자·본문·조건·첨부 승인 체크 → 예약 시간 → **승인한 내용 예약 자동 발송**을 누릅니다. 화면 입력 시간은 기기 시간대를 사용하며, 서버는 광고성 이메일을 한국시간 08~21시로 제한합니다. 예약 가능 범위는 30일입니다. 승인한 미리보기와 해시를 고정하고 실행 시 AI를 다시 호출하거나 카피를 바꾸지 않습니다. 예약 후 후보·상품 버전이 달라지면 발송을 중단하고 재승인을 요구합니다.

`JOB_RUNNER_TOKEN`을 32자 이상의 별도 임의 문자열로 설정하고 Supabase Cron에서 매분 `POST /functions/v1/bright-function/jobs/run`을 호출합니다. 요청 헤더 x-job-token에 동일한 값을 넣습니다. 토큰을 공개 SQL·GitHub·채팅에 저장하지 마세요. 토큰만 설정하고 Cron을 만들지 않으면 자동 실행되지 않습니다. Cron 등록은 사용자 프로젝트 관리 권한이 필요합니다. 무료/유료 실행 한도는 현재 플랜에서 확인해야 합니다.

한 번 호출에 최대 1건을 claim해 처리합니다. 중복 Cron 호출에서도 이미 처리 중인 작업은 재선택하지 않습니다. 성공은 제공자 접수이며 실제 전달/열람이 아닙니다. 처리 실패·불확실·중단된 processing 작업은 자동으로 재시도하지 않습니다. 처리 중 장기 정지/실패는 연동 설정의 예약 목록과 Supabase 로그, Gmail 보낸편지함을 확인하고 직접 판단해야 합니다. 미처리 예약은 서비스 안에서 취소할 수 있습니다. 일일 제한·수신 거부·조건 버전·사업 시간 검사는 실행 시 다시 적용합니다. 예약된 수신자·본문을 바꾸려면 취소 후 새 미리보기로 승인해야 합니다.

Instagram 신규 선제 DM은 예약 자동 발송하지 않습니다. 기존 수신 대화 답장도 별도 승인을 유지하며 메시징 시간 제한을 지킵니다. 현재 AI+예약 자동화의 실제 Supabase 배포·Gmail 계정·유료 AI 응답·Cron 실행은 아직 검증하지 않았고, 로컬 PostgreSQL과 모의 제공자/브라우저에서 구현을 검증했습니다.

### Instagram 여러 계정 (Edge 버전 4)

연동 설정의 ‘Instagram 계정 추가·재인증’에서 계정마다 공식 인증합니다.
Instagram 로그인 화면이 기존 계정을 선택하면 계정 전환하거나 별도 브라우저 프로필에서
서비스에 로그인하여 추가합니다. 비밀번호는 서비스에서 받지 않습니다.
개발 모드에서는 추가할 계정도 앱의 Instagram 테스터 등 허용된 역할과 동의가 필요합니다.
외부 고객 계정 연결에는 필요한 Meta 심사·고급 액세스가 요구됩니다.
계정 연결은 기존 연결을 덮어쓰지 않고 각각 암호화 저장하며 개별 해제가 가능합니다.
수신 대화와 최종 승인 초안은 수신 계정에 고정됩니다. 연결 해제된 계정에서 보낼 수 없고
다른 계정으로 자동 대체하지 않습니다. 기존 계정 정보가 없는 대화는 연결이 하나일 때만
사용하며 여러 계정이면 새 수신 메시지 또는 확인된 대화가 필요합니다.
DB 변경은 없으며 bright-function을 최신 전체 코드로 재배포해야 적용됩니다.
신규 상대에게 먼저 DM을 보내는 기능이나 다계정 제한 우회는 제공하지 않습니다.

### OAuth 및 카피 편집 (Edge 버전 5)

OAuth 요청은 30분 동안 유효하며 일회성입니다. 누락·이미 처리됨·만료 상태를 구분하고
문제가 있으면 설정으로 돌아가는 안내 화면을 표시합니다. 예전 콜백 URL을 새로고침하지 말고
연동 설정에서 연결을 다시 시작합니다. Gmail ‘연결·권한 점검’은 토큰 갱신, Google 프로필과
저장 계정의 일치, gmail.send/gmail.readonly 권한을 점검하며 메시지를 전송하지 않습니다.
발송 스위치와 실제 수신함 도착 여부는 별개입니다.

템플릿 본문에 `{{개인화}}`를 넣으면 AI 또는 직접 작성한 1~2문장이 그 위치에 들어갑니다.
표시가 없으면 기존과 같이 본문 앞에 삽입합니다. 표시가 있는데 개인화가 비어 있으면
미리보기 생성을 막습니다. ‘개인화 작성 지침’은 템플릿별 저장되며 AI 요청에는 해당 지침과
선택한 후보의 공개 근거만 전달합니다. 공통 본문·제목·서명은 AI에 전달하지 않습니다.
브랜드·제품 특징과 크리에이터 콘텐츠·팬층의 적합성도 근거가 있는 정보만 사용해야 합니다.
실제 운영자의 카피·서명·연락처는 공개 저장소나 데모 데이터에 포함하지 않습니다.

OAuth 오류는 Edge 기본 도메인에서 HTML로 렌더링하지 않고 운영 프런트엔드로 302 이동합니다.
기본 Edge 도메인의 HTML 응답 처리로 소스·한글이 깨져 보이는 문제를 피하기 위한 것입니다.
오류 문구는 프런트엔드에서 이스케이프하고 주소에서 제거합니다. Instagram 인증 코드 교환,
장기 토큰 교환, 프로필 조회 단계를 구분하며 외부 오류의 인증 코드·토큰·시크릿은 가립니다.

Instagram 인증 코드 교환 응답은 최신 `data[0].access_token` 형식과 기존 최상위
`access_token` 형식을 모두 지원합니다(Edge 버전 7). 유효한 토큰을 추출하지 못하면
장기 토큰 교환을 호출하지 않습니다. 장기 토큰 응답의 유효기간도 검사합니다.
공식 문서의 장기 토큰 교환 GET 방식은 유지합니다.

Edge 버전 8은 단기 토큰으로 /me 조회가 성공한 경우에만 장기 토큰 교환을 진행합니다.
장기 교환이 실패하면 검증한 단기 토큰을 암호화 저장하고 ‘임시 연결·최대 15분’으로
표시합니다. 15분은 서비스가 정한 로컬 세션 제한이며 공급자가 보장한 유효기간이 아닙니다.
실제 토큰이 먼저 만료될 수 있습니다. 장기 교환 실패를 정상 장기 인증으로 표시하지 않고
실패 이유를 보관합니다. 같은 계정의 기존 장기 연결이 여전히 API 검증을 통과하면
단기 토큰으로 덮어쓰지 않습니다. 전체 계정 목록은 유지하되 만료 계정은 재인증 필요로 표시합니다.

회사 이메일 자동 발굴은 [DISCOVERY.md](DISCOVERY.md)를 참고하세요. 운영 화면에서
함수 코드 복사·수동 배포 안내 카드는 제거했습니다. 검색 연결은 네이버 검색 키를
한 번 저장하면 자동 발굴과 일반 후보 웹검색에서 공유합니다.
Instagram 로그인은 공식 `force_reauth=true`, `enable_fb_login=false`로 계정을
직접 선택하며 인증 코드는 multipart FormData로 교환합니다. 프로필 조회 실패 시
서버 전용 암호화 진단 슬롯을 10분 동안만 사용할 수 있게 보관하며 성공하면 삭제하고,
만료 슬롯은 발굴 실행기가 정리합니다. 진단 슬롯은 연결된 계정·발신자로 쓰지 않습니다.

브랜드 이메일 우선 모드(Edge 버전 11): Instagram 인증 코드 교환 후 프로필 검증이
실패해도 ‘로그인 응답 수신·계정 조회 대기’를 별도로 저장하고 서비스로 돌아갑니다.
해당 기록에는 토큰을 넣지 않고 연결된 계정·메시지 발신자로 사용하지 않습니다.
실제 프로필 검증이 완료된 계정만 기존 Instagram API 연결 목록에 포함됩니다.
브랜드 이메일·발굴·회신 업무는 Instagram 설정과 독립적으로 동작합니다.
