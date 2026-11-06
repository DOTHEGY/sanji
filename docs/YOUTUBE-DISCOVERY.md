# YouTube 크리에이터 탐색 (별도 모듈)

## 구현 범위

메인 Sanji 브랜드/Instagram 발굴, 딜, 메일 발송 큐와 분리된 읽기·초안 전용 화면입니다.

- 화면: `public/workspace/youtube/` (빌드 결과), 원본 `private/youtube-discovery/`, `web/youtube-discovery.js`.
- 서버: 독립 `youtube-discovery` Edge Function. 기존 `bright-function`을 교체하지 않습니다.
- 기존 로그인 세션과 `sanji_members`의 현재 회원 자격을 매 요청 확인합니다. 신규 계정·권한은 만들지 않습니다.
- 협업 브리프를 한정된 검색어로 변환합니다. 편의점/호빵, 급식/먹방 예시와 일반 키워드를 지원하고 수식어를 유지하며 검색어를 직접 수정할 수 있습니다. LLM 의미 검색이 아닙니다.
- 공식 `search.list(type=video)` 최대 2회와 `channels.list` 최대 1회로 채널을 중복 제거하고 원문 채널·영상 링크를 보여 줍니다. 최대 20개 채널이며 전체 검색/페이지 순회/주기 수집은 아닙니다.
- `safeSearch=strict`는 YouTube의 검색 필터일 뿐, 브랜드 안전성·클린 이미지·시청자 연령·평판 검증이 아닙니다. 직접 검토해야 합니다. 별도 적합도·참여율 점수를 계산하지 않습니다.
- API 설명의 일반 이메일 패턴은 표시에서 가립니다. 이메일 추출·고정댓글 수집·숨겨진 비즈니스 이메일·CAPTCHA 우회는 구현하지 않습니다.
- 협업 문의용으로 공개된 주소 또는 이 목적에 제공받은 이메일을 사용자가 출처·게시 용도와 함께 직접 입력하고 초안을 검토합니다. 선택한 수신자/내용을 확인한 뒤 기본 메일 앱을 여는 흐름만 제공하며 최종 발송은 사람이 수행합니다. 서버 발송, 기존 발송 큐 연계, 자동 일괄 발송은 없습니다.
- 검색/이메일/초안은 DB, localStorage 등에 저장하지 않습니다. 로그인 세션 저장소만 기존 방식대로 사용합니다. 화면 갱신·로그아웃·사용자 변경 시 결과와 초안을 비웁니다.

## 정책상 제외한 요구

YouTube 공식 정책 안내는 이용자의 동의 없이 이메일 등 연락처를 수집/도출/저장하지 않도록 요구합니다. 공개 설명에 적혀 있다는 사실만으로 CRM 수집·마케팅 연락 동의로 간주하지 않습니다. 따라서 원래 요청의 자동 이메일 긁기는 넣지 않았습니다. YouTube 도움말은 소유자가 About에 제공한 이메일로 메시지를 보내는 경로를 안내합니다. 따라서 수동 확인한 협업용 공개 주소의 사용 전체가 금지된다는 뜻은 아닙니다. 채널·소속사의 별도 공식 사이트 Contact 페이지에서 얻은 주소는 별도 출처로 기록하고 사이트 접근 규칙과 연락 목적을 확인할 수 있습니다. 다만 API/YouTube 페이지를 대량 수집하는 방식으로 바꾸지 않습니다.

공식 Comment/CommentThread 리소스에는 고정 여부 필드가 없습니다. 관련성순 첫 댓글을 고정댓글이라고 표시할 수 없습니다. 댓글 작성자가 채널 소유자인지는 `authorChannelId.value` 비교로 확인할 수 있으나, 이 버전은 댓글을 요청하지 않습니다.

## 활성화 전 필요한 승인과 확인

배포 여부는 해당 변경의 PR·CI·운영 확인 결과를 기준으로 판단합니다. 코드 배포와 실제 YouTube 연결 활성화는 별개입니다. API 키가 없으면 검색은 실행되지 않습니다.

1. 코드 검토와 테스트 후 일반 코드 병합·운영 배포를 별도로 승인받습니다. main push는 기존 GitHub Pages workflow를 실행하므로 승인 전 수행하지 않습니다.
2. Google Cloud의 YouTube Data API v3 연결 상태와 기존 키 유무를 확인합니다. 필요하면 해당 API 사용이 허용된 서버용 `YOUTUBE_API_KEY`의 신규 생성/영구 설정을 별도로 승인받습니다. 키를 브라우저 번들·Git·채팅에 넣지 않습니다.
3. 서버에서 `YOUTUBE_DISCOVERY_ENABLED=true`를 승인 후 설정합니다. 기본값은 비활성입니다. `APP_ORIGIN`은 기본 `https://dothegy.github.io`이며 필요한 운영 출처만 명시합니다.
4. 기존 프로젝트의 기존 서버 자격증명으로 독립 함수를 배포합니다. `verify_jwt=true`를 유지하고 함수 내부 `auth.getUser` + 회원 확인을 제거하지 않습니다. 새로운 DB 테이블, migration, OAuth 범위, 발송 권한은 필요하지 않습니다.
5. 실제 로그인 사용자로 검색/회원 거절/키 미설정/쿼터 제한을 스모크 테스트합니다. 실제 메일은 테스트로 보내지 않습니다.
6. 운영 전 개인정보 고지·YouTube API 이용약관 링크·동의 관리와 광고성 메시지 관련 요건을 확인합니다. 이 버전의 체크박스는 출처·비즈니스 용도 확인이며 동의의 법적 증빙 저장소가 아닙니다.

## 쿼터·운영 한계

2026-11-06 조회한 공식 문서 기준 검색은 기본 100회/일 별도 할당, 기타 API는 기본 10,000 unit/일입니다. 이 버전은 검색 최대 2회 + 채널 조회 1회/요청을 사용합니다. 실제 Google Cloud 프로젝트 할당과 다른 앱 소비량을 배포 전에 확인하세요. 오류·추가 페이지도 비용이 들 수 있습니다. 임의 재시도를 하지 않습니다.

동일 사용자 30초 간격 및 동시 실행 제한은 Edge isolate 메모리 기준의 보조 제한입니다. 전역·영구 rate limit이라고 주장하지 않습니다. 여러 isolate/사용자는 Google 프로젝트 할당을 공유합니다. 사용량 확대 전 별도 전역 제한을 검토해야 합니다.

API 데이터는 화면 메모리에서만 유지합니다. 장기 저장이 추가되면 조회일과 30일 이내 새로고침/삭제 정책을 구현해야 합니다. 요청·응답 또는 연락처를 서버 로그에 기록하지 않습니다.

## 실행·검증

```sh
npm run build:youtube-discovery
npm run test:youtube-discovery
npm run build:supabase
npm test
```

브라우저 테스트는 `/usr/bin/chromium` (또는 CHROMIUM_PATH)과 모의 API만 사용합니다. 서버 테스트는 실제 YouTube/메일을 호출하지 않습니다. 실제 API 키와 운영 배포를 통한 검증은 별개입니다.

## 공식 근거

- https://developers.google.com/youtube/terms/developer-policies-guide (개인정보와 연락처 수집)
- https://developers.google.com/youtube/terms/developer-policies (보관, 도출 데이터, scraping 제한)
- https://developers.google.com/youtube/data/reference/rest/v3/search/list
- https://developers.google.com/youtube/data/reference/rest/v3/channels
- https://developers.google.com/youtube/data/reference/rest/v3/comments
- https://developers.google.com/youtube/data/reference/rest/v3/commentThreads
- https://developers.google.com/youtube/data/determine_quota_cost
- https://support.google.com/youtube/answer/57955?hl=en (비즈니스 문의 이메일)
- https://supabase.com/docs/guides/functions/auth

## 공식 사이트 업무 연락처 보조 확인

`POST /business-contacts`는 선택한 채널 ID와 공식 페이지 URL만 받습니다. 서버가 관리하는 출처 검토 목록에서 정확한 페이지, 해당 채널 소속 근거, 자동접근 규칙·약관 검토가 모두 확인되어야 GET 1회로 분석합니다. 요청자가 `approved` 플래그나 정책·소속 정보를 보내도 허용되지 않습니다.

현재 실제 자동 허용 출처는 **0개**입니다. 조사한 TreasureHunter, SANDBOX, LEFERI는 공개 비즈니스 문의 페이지는 확인했지만 자동접근 규칙을 모두 검증하지 못해 수동 원문 링크로만 제공합니다. 이 목록이 선택한 크리에이터의 소속을 의미하지 않습니다. 자동 정책 미확인은 허용도 차단도 단정하지 않는 상태이며, 시스템은 외부 요청을 하지 않습니다.

후속 검토에서 허용할 때는 서버 코드의 정확한 출처 레코드에 다음을 기록해야 합니다: 업무 페이지 URL, 채널 ID, 기관명, 공식 소속 근거 URL·문구·확인일, 허용 이메일 도메인, robots·약관 원문 URL·검토 근거·검토일. 7일이 지난 정책/소속 기록은 재검토 전 자동 수집을 막습니다. 도메인 전체가 아닌 검토한 페이지 하나만 요청하며 리다이렉트·비HTML·접근 차단·보안 확인이 있으면 중단합니다. 우회·자동 재시도하지 않습니다.

후보는 주변 문구가 광고·협업·사업제휴 용도를 명시하고, `biz`, `business`, `partnerships`, `ads` 등 검토한 도메인의 공용 업무 주소일 때만 나옵니다. 개인 이름 주소·개인정보·고객지원·채용·팬메일은 제외합니다. HTML에서 사람에게 숨겨진 값이나 mailto 속성만으로 주소를 도출하지 않습니다. 후보는 기관 공용메일로 표시하고 소속 근거·원문·확인시각을 함께 보여 줍니다. 선택해 입력해도 최종 검토 체크를 새로 해야 하며 자동 발송하지 않습니다.

검증은 가상 승인 출처와 모의 HTTP 응답으로 수행합니다. 실제 허용 출처가 0개라는 사실과 구분해야 합니다. `tests/youtube-business-contacts.test.cjs`는 미확인·만료·소속 불일치 무요청, 개인정보 주소 배제, 업무 목적 누락, 주소 추측 금지, 요청 정책 위조 거부, 크기 제한, 차단·리다이렉트 무재시도를 검증합니다.

현재 자동 후보 분석기는 CSS·숨김·폼 등 복잡한 HTML이나 개인정보/지원/부정된 협업 문구가 섞인 페이지 전체를 보수적으로 제외합니다. 활성 출처를 등록하기 전에 실제 사이트에 맞는 DOM 기반 가시성·섹션 검증과 DNS/사설 주소 egress 방어를 별도로 검증해야 합니다. 현재 프로덕션 출처 목록은 비어 있어 이 추가 검증 전 외부 자동 조회는 발생하지 않습니다.
