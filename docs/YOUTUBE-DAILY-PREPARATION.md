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

시작 전 준비한 과거 목록은 발송하지 않습니다. 활성화 이후 새 검토·준비 또는 다음 일일 실행이 필요하며 60명의 즉시 발송을 보장하지 않습니다. 목표는 YouTube 50명과 기존 Instagram 10명이며 부족하면 부족한 수를 표시합니다. `accepted`는 Gmail의 접수이지 수신함 도착이나 열람이 아닙니다. `outcome_unknown` 항목은 자동 재발송하지 않습니다.

## 비공개 JSON 가져오기

파일은 최대 5 MiB입니다. 파일 선택 시 로컬에서만 JSON과 PNG 원본 해시·전체 청크 CRC·실제 브라우저 디코드·크기·계정·승인 출처를 검증하고 제목, 본문, 사진 두 장을 미리 표시합니다. 명시적 확인 후 저장 버튼을 눌러야 서버에 전송합니다. 기존 Gmail 서명은 서버의 현재 설정에서 읽습니다. 파일에 서명, API 키, OAuth 토큰, 비밀번호를 넣지 마세요. 개인 원본은 저장소·번들·테스트 fixture에 포함하지 않습니다.

최상위는 `{snapshot, policy}`이며 과거 내보내기 파일의 `expectedRevision`도 읽을 수 있지만 무시합니다. 저장 요청의 버전은 현재 서버 조회 결과만 사용합니다. `policy`를 생략하면 `pending_review`, 한국시간 09:00, `confirmed:false`이며 승인·반복 실행으로 승격하지 않습니다.

`snapshot` 필수 형태:

- `version: 1`, `owner: 현재 인증 사용자 UUID`
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

모든 요청은 기존 로그인 세션과 현재 계정에 묶습니다. 계정 전환·페이지 종료 시 요청을 취소하고 미리보기·사진 데이터·검토 초안을 지웁니다. HTML을 실행하지 않고 본문은 textContent로 표시합니다. 원본과 검토 내용은 브라우저 영구 저장소에 기록하지 않습니다.

POST는 절대 자동 재시도하지 않습니다. 결과가 불확실하면 해당 버튼을 잠그고 상태 조회만 합니다. 불확실한 탐색은 같은 한국 날짜의 완료·실패 기록으로 확인합니다. 같은 날 기존 준비 기록이 있다는 이유만으로 불확실한 추가 준비를 성공으로 간주하지 않습니다. 명확한 새 설정·근거 기록으로 확인 가능한 경우만 잠금을 해제하며, 해결되지 않은 요청은 서버 이력 확인이 필요합니다. 일시정지는 다른 작업의 불확실성과 별개로 가능한 범위에서 허용합니다.

서버 미배포, 조회 오류, 불완전한 원본을 후보 0명으로 표현하지 않습니다. 후보 검토는 플랫폼별 50명 페이지로 표시하여 YouTube가 많아도 기존 Instagram 후보에 접근할 수 있습니다. 합계 10,000개 안전 한도 내 전체 후보를 검토할 수 있습니다. 수신자 기록은 서버의 1,000개 한도를 따릅니다.

## 검증

`npm run test:youtube-campaign`은 준비 전용 회귀, 전체 제어, 비공개 설정 검증, 계정 전환, 이중 클릭, 응답 유실, 버전 계약, 실행 연결 상태, 근거 입력 및 안전 렌더링을 검사합니다. 테스트는 합성 fixture와 최소 DOM 대역이며 실제 Chromium 시각 QA를 대신하지 않습니다. 기존 환경에서 Chromium의 socket 권한 제한으로 시각 QA는 미검증입니다.
