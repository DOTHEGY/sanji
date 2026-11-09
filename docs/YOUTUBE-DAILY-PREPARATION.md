# 일일 크리에이터 캠페인 UI

기존 `state: preparation_only` 서버는 기존 준비 전용 UI를 사용합니다. `/status`가 명시적으로 `state: campaign`을 반환할 때만 전체 제어 화면으로 전환합니다. 운영 배포, 메일 전송, 스케줄 활성화는 이 코드 변경만으로 일어나지 않습니다.

## 화면과 요청

- 상태: GET `/status`, `/configuration`, `/runs`, `/supply-review`, `/recipient-reviews`, `/source-reviews`.
- 오늘 신규 후보 탐색: POST `/collect` `{}`. YouTube 검색만 실행하고 응답 대기는 135초입니다. 검색 후보는 검증된 연락처나 수신자가 아닙니다.
- 검토한 후보 준비: POST `/prepare` `{}`. 오늘의 탐색이 완료되어야 하며 응답 대기는 110초입니다. 같은 날 새 근거가 추가되면 남은 목표 수만 준비할 수 있습니다. 준비 수와 Gmail 접수 수는 분리합니다.
- 비공개 원본 저장: POST `/configure` `{expectedRevision, snapshot, policy}`. 항상 일시정지하며 새 버전을 만듭니다.
- 후보 근거 저장: POST `/review-candidate`. 최신 관측과 실제 확인한 출처만 제출합니다.
- 수신자 근거 저장: POST `/review-recipient`. 공개 이메일만으로 수신 동의나 발송 근거를 승인하지 않습니다.
- 출처 등록 요청: POST `/register-source-review` `{creatorKey, sourceUrl, sourceKind}`. 신규 출처는 pending이며 등록은 승인·수집·발송이 아닙니다.
- 일일 실행 허용: POST `/schedule` `{expectedRevision}`. 기존 버전을 유지합니다. 명시적인 사용자 체크와 클릭, 서버 배포 조건, 분류·일정 검토 통과가 필요합니다. 실제 외부 반복 실행 연결은 별도이며 미확인 상태를 숨기지 않습니다.
- 일시정지: POST `/pause` `{expectedRevision}`. 새 버전으로 일시정지합니다.
- 직접 발송 버튼과 `/send`, `/dispatch`, worker 호출은 없습니다.

시작 전 준비한 과거 목록은 발송하지 않습니다. 활성화 이후 새 검토·준비 또는 다음 일일 실행이 필요하며 60개 주소의 즉시 발송을 보장하지 않습니다. 목표는 YouTube 50개와 기존 Instagram 10개의 서로 다른 검증된 공개 업무 이메일주소이며 부족하면 부족한 수를 표시합니다. `accepted`는 Gmail의 접수이지 수신함 도착이나 열람이 아닙니다. `outcome_unknown` 항목은 자동 재발송하지 않습니다.

## 비공개 JSON 가져오기

파일은 최대 5 MiB입니다. 파일 선택 시 로컬에서만 JSON과 PNG 원본 해시·전체 청크 CRC·실제 브라우저 디코드·크기·계정·승인 출처를 검증하고 제목, 본문, 사진 두 장을 미리 표시합니다. 명시적 확인 후 저장 버튼을 눌러야 서버에 전송합니다. 기존 Gmail 서명은 서버의 현재 설정에서 읽습니다. 파일에 서명, API 키, OAuth 토큰, 비밀번호를 넣지 마세요. 개인 원본은 저장소·번들·테스트 fixture에 포함하지 않습니다.

최상위는 `{snapshot, policy}`이며 과거 내보내기 파일의 `expectedRevision`도 읽을 수 있지만 무시합니다. 저장 요청의 버전은 현재 서버 조회 결과만 사용합니다. `policy`를 생략하면 `pending_review`, 한국시간 09:00, `confirmed:false`이며 승인·반복 실행으로 승격하지 않습니다.

`snapshot` 필수 형태:

- `version: 2`, `owner: 현재 인증 사용자 UUID`
- `recipientCriteria`: `{version:1, audienceBounds:{youtube:{minimum:30000,maximum:200000},instagram:{minimum:30000,maximum:500000}}, targets:{youtube:50,instagram:10}, targetUnit:"distinct_verified_business_email", maxEmailsPerCreator:1, dedupeScope:"cross_platform", approvalSource}`. 승인 출처는 비어 있지 않은 4,000자 이하 원문입니다. 버전 1 파일은 현재 기준으로 가져오지 못하며 과거 서버 기록만 보존합니다.
- `productMode: approved_campaign_assets`, `products: []`
- `campaignProducts`: 마라쫀득빵, 짬뽕쫀득빵 순서의 `{name, approvalSource}` 두 개. 공유 사진 두 장을 캠페인 전체와 고정 문안에 묶으며 SKU별 사진 대응을 추측하지 않습니다.
- `template`: `{owner, revision, approved:true, approvalSource, subject, body, requiredInlineImageIds:[id1,id2]}`. 원문을 다시 작성하지 않고 `[채널명]`만 실제 채널명으로 치환합니다.
- `images`: `{id, owner, verified:true, sharingApproved:true, mimeType:'image/png', content:base64, bytes, sha256, width, height, alt?}` 두 개.
- `signature`, 추가 인증정보 또는 임의 필드는 받지 않습니다.

`policy`: `{classification, classificationSource, authorizationSource, schedule:{timezone:'Asia/Seoul', hour, minute, confirmed}}`. 분류는 `pending_review`, `solicited_non_marketing_proposal`, `reviewed_non_marketing_business_proposal`, `marketing` 중 하나입니다. 광고성 메시지는 현재 별도 요건 검토로 보류되며 UI가 다른 분류로 자동 바꾸지 않습니다.

사진은 일반 첨부가 아니라 기존 Gmail 서명 위의 본문 사진 두 장입니다. `verified_inline_product_images_required`, `inline_product_images_required`, 이전 서버의 `verified_product_attachments_required`를 모두 “서명 위 본문 사진 확인 필요”로 표시합니다.

## 근거 검토

검색 후보의 빈 JSON 양식은 크리에이터 ID와 관측 시각만 복사하고 `verified:false`로 시작합니다. 이름·채널 연결은 YouTube 밖의 독립 공식 출처 또는 크리에이터 제공 근거가 필요합니다. 연락처 근거를 생략하면 연락처 검토 보류 상태로 남습니다. YouTube 정보 탭·설명·댓글에서 이메일을 자동 수집하지 않습니다.

기존 Instagram 후보는 원래 데이터베이스의 이름·프로필·ID를 유지합니다. 검토 JSON은 `{creatorKey, sourceRecordId, sourceRecordUpdated, audience, audienceSource, audienceCheckedAt, lastActiveAt, activitySource, activityCheckedAt, mukbang, contactEvidence?}`입니다. 팔로워 3만~50만 및 최근 90일 활동을 새로 확인해야 하며, 오래된 수치를 자동 승인하지 않습니다. 원래 제외 상태는 덮어쓰지 못합니다.

수신자 검토 JSON은 `{creatorKey, recipient, status, kind, classification, classificationSource, sourceUrl, sourceText, verifiedAt, expiresAt, approvalSource}`입니다. `status`는 실제 확인 후 `approved` 또는 `revoked`로 지정합니다. `kind`는 분류에 따라 `solicited_proposal` 또는 `documented_business_proposal`이며 현재 설정 버전은 UI가 붙입니다. 승인 근거는 매 수신자별 확인해야 합니다. 입력을 바꾸면 확인 체크가 해제됩니다.

## 오류와 개인정보

모든 요청은 기존 로그인 세션과 현재 계정에 묶습니다. 계정 전환·페이지 종료 시 요청을 취소하고 미리보기·사진 데이터·검토 초안을 지웁니다. 로컬 설정의 본문은 textContent로 표시합니다. 서버가 완성한 개별 이메일 HTML은 아래 제한된 iframe에서만 표시합니다. 원본과 검토 내용은 브라우저 영구 저장소에 기록하지 않습니다.

POST는 절대 자동 재시도하지 않습니다. 결과가 불확실하면 해당 버튼을 잠그고 상태 조회만 합니다. 불확실한 탐색은 같은 한국 날짜의 완료·실패 기록으로 확인합니다. 같은 날 기존 준비 기록이 있다는 이유만으로 불확실한 추가 준비를 성공으로 간주하지 않습니다. 명확한 새 설정·근거 기록으로 확인 가능한 경우만 잠금을 해제하며, 해결되지 않은 요청은 서버 이력 확인이 필요합니다. 일시정지는 다른 작업의 불확실성과 별개로 가능한 범위에서 허용합니다.

서버 미배포, 조회 오류, 불완전한 원본을 후보 0명으로 표현하지 않습니다. 후보 검토는 YouTube와 기존 Instagram 필터를 유지합니다. 현재 유효 YouTube 검색 스냅샷은 최대 5,000개 응답을 로컬에서 50명씩 표시하고, 기존 Instagram은 GET `/supply-review?cursor=<UUID>`로 원본 50개씩 조회합니다. 첫 페이지에는 cursor가 없습니다. 응답 범위는 `paged_native_instagram_and_current_youtube_snapshots`, `preparationEligibilityChecked:false`이며, Instagram 페이지 정보의 scope는 `existing_instagram_database`입니다. 전체 원본 수가 26,552개여도 한 페이지 응답만 보관하고 다음 버튼을 누를 때만 한 번 조회합니다. 전체를 자동 수집하지 않습니다.

공식 연락처 출처 목록은 후보 원본 전체와 독립적인 등록 출처 목록입니다. GET `/source-reviews?cursor=<UUID>`로 등록 source ID 20개씩 조회하고 각 출처의 최신 버전을 표시합니다. 범위와 페이지 scope는 `registered_contact_sources`입니다. 화면은 현재 계정의 전체 원본/등록 출처 수, 이번 페이지 수, 이후 남은 수를 구별합니다. `pagination.remaining`은 들어온 cursor 이후의 이번 페이지를 포함하므로 이후 남은 수는 `remaining - returned`입니다. 숫자는 검토 완료·발송 가능 인원 수가 아닙니다. 다음/이전은 목록별 cursor 이력을 사용하며 전체 새로고침은 현재 페이지와 플랫폼을 유지합니다.

후보 페이지나 플랫폼이 바뀌면 입력 초안과 확인 체크를 지우고 선택한 새 행의 원본 ID·갱신 시각에 검토를 다시 묶습니다. 조회 실패는 기존 페이지를 유지하면서 오류를 표시하며 다음 페이지로 이동한 것으로 처리하지 않습니다. 잘못된 원본 계정 식별자는 검토 보류로 표시하고 선택을 허용하지 않습니다. 계정 종료 시 모든 목록·cursor와 진행 중 GET을 지웁니다. 결과가 불확실한 POST는 현재 부분 페이지에 기록이 없다는 이유로 실패나 재시도 가능 상태로 판단하지 않습니다.

목록 페이지 조회는 준비 대상 적격성이나 전체 과거 발송 이력 검증이 아닙니다. `/prepare`는 서버의 검토 가능한 원본 범위와 이력 검증을 별도로 따릅니다. 원본이 10,000개를 넘어도 원본 수만으로 준비를 차단했다고 추측하지 않으며, 목록 표시만으로 자동 발송 준비 완료라고 표현하지 않습니다. 수신자 기록은 기존 서버의 1,000개 한도를 따릅니다.

## 검증

`npm run test:youtube-campaign`은 준비 전용 회귀, 전체 제어, 비공개 설정 검증, 계정 전환, 이중 클릭, 응답 유실, 버전 계약, 실행 연결 상태, 근거 입력 및 안전 렌더링을 검사합니다. 추가로 26,552개 합성 원본의 bounded 페이지, 독립 출처 페이지, 이전/다음과 마지막 페이지, 잘못된 페이지 메타데이터, 명시적 클릭 한 번당 GET 한 번, 오류·이중 클릭·계정 변경 및 부분 조회에서의 불확실 POST 보존을 검사합니다. 테스트는 합성 fixture와 최소 DOM 대역이며 실제 Chromium 시각 QA를 대신하지 않습니다. 기존 환경에서 Chromium의 socket 권한 제한으로 시각 QA는 미검증입니다.


## 간소화된 기본 화면과 개별 카피

기본 화면은 주제 모음과 채널명·이메일주소·구독자수 3열입니다. 메일 주소는 CRM에 저장된 공개 출처 후보 하나만 표시하고 검토 필요를 명시합니다. 추가 주소와 근거는 행의 상세에 보존합니다. 목록 행 수나 공개 주소 후보 수를 검증 주소 수로 승격하지 않습니다. 구독자 3만–20만 밖과 규모 미확인 기록은 접힌 조사 기록으로 유지하며 삭제하지 않습니다. 모음 추가·관리, 조사 도구, 근거 검토, 설정·예약·이력은 닫힌 상세 영역에서 계속 사용할 수 있습니다.

현행 준비 집계는 정확한 `audienceBounds`, `targetUnit:distinct_verified_business_email`, `maxEmailsPerCreator:1`, `dedupeScope:cross_platform`과 합이 맞는 `counts/shortfall`이 있을 때만 50개·10개 주소 목표로 표시합니다. 예전 집계는 과거 기록이라고 명시합니다. 정규화와 플랫폼 간 공유 메일함·별칭 중복 제외 및 최종 적격성은 서버가 판단합니다.

개별 카피는 채널 행의 **카피 보기**를 누를 때만 POST `/preview` `{creatorKey, expectedRevision}`으로 요청합니다. 클라이언트가 이름·이메일·카피를 제출하지 않습니다. 서버가 현재 계정의 저장된 후보와 최신 비공개 설정·Gmail 서명을 확인해 고정 카피의 `[채널명]`만 바꾸고 사진 두 장을 기존 서명 위에 한 번 배치합니다. 이 요청은 메일·Gmail 초안·예약을 만들지 않습니다.

응답은 `{previewOnly:true,sendingEnabled:false,creatorKey,channelName,recipient:null|string,subject,html,imageCount:2,templateRevision,policyRevision,snapshotId,scopeHash,warnings:string[]}`이며 인증과 `Cache-Control:no-store`가 필요합니다. UI는 후보·현재 정책 버전·스냅샷·이미지 수를 확인하고, 빈 `sandbox` 속성과 `referrerpolicy=no-referrer`의 iframe에만 렌더링합니다. CSP는 외부 요청·스크립트·폼·base URL을 차단하고 `data:` 이미지만 허용합니다. 개인정보는 URL·로그·브라우저 영구 저장소에 기록하지 않습니다.

카피 닫기, 계정 변경, 로그아웃, 페이지 종료, 설정 버전·서명 차단 상태 변경은 iframe 내용을 비우고 진행 요청을 취소합니다. 같은 후보의 반복 클릭은 진행 중 요청을 복제하지 않고, 더 최근 후보 선택 후 도착한 오래된 응답은 표시하지 않습니다. 설정 미등록·미배포·오류는 있는 그대로 표시하며 확인되지 않은 내용을 대신 생성하지 않습니다. Gmail 연결 상태는 서버의 `gmailConnected` 요약이며 OAuth 실시간 재검증이나 발송 가능성 보장이 아닙니다. 전송 기능·예약 상태와 분리해 표시합니다.

새 DOM·단위 검사는 3열 구조, 모음·조사 기록 보존, 양 끝 구독자 기준, 주소 단위 계약, 버전 2 가져오기, 개인별 preview 요청, 격리·닫기·세션 및 버전 변경·응답 지연을 포함합니다. Chromium 시각 검사는 환경의 기존 소켓 권한 제한으로 실행하지 않았습니다.

대규모 원본의 부분 준비 결과에 `morePreparationRequired:true`가 있으면 고급 관리의 준비 버튼을 “남은 검토 후보 계속 준비”로 표시합니다. 매번 명시적 클릭 한 번에 빈 객체로 POST `/prepare` 한 번만 요청합니다. 서버 내부 snapshot/digest/cursor는 표시하거나 요청에 보내지 않습니다. `executionProgress.exhausted`는 현재 검토 가능한 자료 범위의 끝이며 목표 달성·전체 원본 검토 완료가 아닙니다. `unreviewedInstagram`은 일일 근거 검토가 없는 원본 수로 구분합니다. 오류·불확실 저장은 기존 잠금과 상태 재조회 규칙을 그대로 따릅니다.


## 오늘 준비한 수신 주소

기본 화면에는 GET `/prepared-recipients`의 현재 한국 날짜 준비 목록을 YouTube와 Instagram 별도 3열 표로 표시합니다. 열은 채널명·이메일·구독자수 또는 팔로워수이며 각 행의 카피 보기는 기존 인증된 미리보기만 요청합니다. 전체 원본 데이터베이스를 조회하거나 자동으로 준비·발송하지 않습니다.

읽기 전용 응답은 `{day,scope:'current_day_prepared_recipients',items:[{creatorKey,platform,name,email,audience}],counts:{youtube,instagram},preparationOnly:true,sendingEnabled:false,gmailHistoryChecked:false}`입니다. 현재 날짜·플랫폼·규모·정확한 행 수·YouTube 최대 50개/Instagram 최대 10개를 검증하며 동일 크리에이터 및 플랫폼 간 동일 수신함·Gmail 별칭이 중복되면 전체 응답을 보류합니다. 이 목록은 서버의 최신 기준·유효기간 필터를 통과한 준비 자료이나 Gmail 전체 발송 이력 확인이나 발송 가능성 보장이 아닙니다.

성공한 빈 목록만 0/50개·0/10개와 부족 50개·10개를 명시합니다. 실패·형식 불일치·지난 날짜는 0으로 바꾸지 않습니다. 새로고침 시작 즉시 이전 행을 지우고, 로그아웃·계정 변경·페이지 종료 후 늦은 응답과 이전 행의 이벤트는 폐기합니다. 전체 상태 읽기는 기존 6개 GET에 이 엔드포인트 1개를 추가합니다.

저장 후보 주표는 구독자 3만–20만이며 유효한 공개 이메일 문자열이 기록된 행만 표시합니다. 주소가 없거나 형식이 맞지 않는 행은 “이메일 미확인·규모 미확인/범위 외 조사 기록”에 보존합니다. 표시되는 주소도 기존 “공개 주소 후보 · 검토 필요” 라벨을 유지하며 최신 준비 목록이나 발송 승인으로 자동 승격하지 않습니다. 필터는 화면에서만 적용하고 데이터는 변경하지 않습니다.
