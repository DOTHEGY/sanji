# 일일 크리에이터 캠페인 발송 어댑터

## 구현 상태와 실제 운영 상태

이 변경은 기존 준비 기능 다음의 **비공개 설정 → 당일 큐 → claim → 기존 outbox 예약 → Gmail 재검사 → 일회성 발송 허가 → 공급자 결과 저장**을 구현합니다. 로컬 테스트에서는 Gmail과 계정 연결을 모두 모의 처리합니다. 실제 메일, Gmail 초안, 운영 DB 쓰기, 마이그레이션 적용, 반복 작업 등록, 인증정보 읽기·변경, 병합 및 배포는 수행하지 않습니다.

운영 활성화에 필요한 저장·권한·배포·스케줄 승인은 별도입니다. 공개 업무 이메일이 있다는 이유로 수신 동의나 메시지의 법적 분류를 승인하지 않습니다. 검토 근거가 없는 수신자는 `recipient_basis_required`로 보류합니다. 하루 50명 YouTube + 기존 DB 10명 Instagram은 최대 목표이며 부족분을 다른 대상으로 채우지 않습니다.

## 새 파일

- `private-config.mjs`: 소유자·버전·원본 해시로 고정한 비공개 템플릿, Gmail 서명, 사진 2장과 제품 2개 범위.
- `dispatch-repository.mjs`: 기존 서버 Supabase 클라이언트의 소유자별 읽기와 새 service-only RPC 연결.
- `dispatch.mjs`: 기본 비활성 상태의 발송 상태 머신. 직접 발송용 HTTP 엔드포인트가 아닙니다.
- `sender-runtime.mjs`: 기존 Gmail 연결을 재사용하는 읽기·일반 토큰 갱신·이력 조회·발송 어댑터와 선택적 내부 실행 핸들러. 등록/권한/설정 변경은 없습니다.
- `supabase/pending/creator-daily-campaign.sql`: 검토용 추가 SQL. 배포가 자동 적용하는 마이그레이션이 아닙니다.

기존 `creator-email-isolated`의 Instagram 수신자별 요청 제안 규칙과 native 예약 검증 함수는 수정하지 않습니다. YouTube ID를 Instagram creator ID로 변환하지 않습니다. 별도 캠페인 예약 어댑터가 동일한 owner advisory lock 아래에서 즉시 소비된 native draft와 native outbox를 만듭니다. 예약 결과가 불명확하면 그 예약을 복구해 발송하지 않습니다.

## 설정과 비공개 저장

이 캠페인의 권장 제품 범위는 `productMode:'approved_campaign_assets'`, `products:[]`, `campaignProducts:[{name:'마라쫀득빵',approvalSource:'실제 사용자 승인 출처'},{name:'짬뽕쫀득빵',approvalSource:'실제 사용자 승인 출처'}]`입니다. 사용자가 제공한 두 상품명과 사진 두 장, 정확한 본문을 하나의 immutable scopeHash로 묶습니다. 카탈로그 상품이 없다는 이유로 관련 없는 상품을 선택하거나 새 가격·조건·사실을 만들지 않습니다. 사진은 함께 제공되었으므로 어느 사진이 어느 SKU인지 추정하여 연결하지 않습니다. 사진의 원래 순서와 일반적인 “제품 사진 1/2” 설명을 유지합니다.

이 방식은 캠페인 전용 승인 자산을 검증하는 별도 어댑터입니다. 기존 isolated sender의 catalog product 검증을 완화하거나 우회하는 변경이 아닙니다. sender/account/signature, 공개 연락처 원문, 개별 법적 분류·근거, 회신·수신거부, 중복 검사, 일회성 grant는 그대로 요구합니다. 기존 카탈로그를 사용하는 `catalog` 모드도 지원하며 아래 JSON의 `products` 부분은 그 모드의 예시입니다.

`createDailyDispatchRuntime({sb, env, request?, now?, uuid?, candidateResolver?, recurringTriggerVerified?})`가 `configuration`, `configure`, `schedule`, `pause`, `reviewRecipient`, `recipientReviews`, `runs`, `run`을 제공합니다. 직접 `processOne`은 내부 테스트/작업자용이며 사용자 HTTP 경로에 노출하지 않습니다.

`configure(owner, {expectedRevision, snapshot, policy})`의 snapshot 입력:

```json
{
  "version": 1,
  "owner": "authenticated-owner-uuid",
  "template": {
    "owner": "authenticated-owner-uuid",
    "revision": 1,
    "approved": true,
    "approvalSource": "실제 사용자 카피 승인 출처",
    "subject": "승인된 제목",
    "body": "승인된 원문. [채널명]만 치환합니다.",
    "requiredInlineImageIds": ["original-image-1", "original-image-2"]
  },
  "images": [
    {"id":"original-image-1","owner":"authenticated-owner-uuid","verified":true,"sharingApproved":true,"mimeType":"image/png","content":"원본 PNG의 base64","bytes":12345,"sha256":"64자리 원본 해시","width":764,"height":1024},
    {"id":"original-image-2","owner":"authenticated-owner-uuid","verified":true,"sharingApproved":true,"mimeType":"image/png","content":"다른 원본 PNG의 base64","bytes":12345,"sha256":"64자리 원본 해시","width":764,"height":1024}
  ],
  "products": [{"id":"first-product-uuid","version":1},{"id":"second-product-uuid","version":1}]
}
```

위 값은 계약 예시일 뿐 실제 사용자 정보나 유효한 이미지가 아닙니다. 실제 제품 ID와 버전은 기존 계정의 제품 목록에서 선택해야 하며 추측하지 않습니다. 정확한 본문·사진·서명은 공개 코드나 빌드 파일에 넣지 않습니다.

`catalog` 모드에서 제품을 지정하지 않고 `products:[]`만 저장하면 `product_scope_missing`을 표시하고 예약·발송은 막습니다. `approved_campaign_assets` 모드에서는 위 명시적인 두 상품 승인 범위를 대신 요구하며 카탈로그를 읽거나 쓰지 않습니다.

브라우저의 `signature.verified` 같은 플래그를 신뢰하지 않습니다. `signature`를 생략하면 서버가 현재 설정과 연결 요약을 읽어 Gmail 출처, 현재 발신 계정, 기존 HTML/text, settings ID/version 및 senderName을 고정합니다. `signature`가 있으면 서버 값과 전체가 일치해야 합니다. 실제 발송 직전에는 연결 요약뿐 아니라 Gmail profile의 실제 계정도 다시 확인합니다.

이미지 base64는 별도 공개 버킷이나 외부 URL 없이 RLS + service-only 테이블에 템플릿과 함께 저장합니다. immutable trigger와 UPDATE/DELETE 권한 부재가 원본 변경을 막습니다. 변경할 때 새 snapshot/revision을 만들며 자동으로 일시 정지합니다. 전체 contentHash, scopeHash, 각 이미지 해시, 제품 현재 데이터 해시와 버전을 모두 검사합니다. 이 영속 저장의 운영 적용이나 새 권한을 지금 만들지는 않습니다.

`policy`는 다음을 받습니다:

- `classification`: `pending_review`, `solicited_non_marketing_proposal`, `reviewed_non_marketing_business_proposal`, `marketing`.
- `classificationSource`, `authorizationSource`: 실제 검토 및 사용자 권한 출처.
- `schedule`: `{timezone:'Asia/Seoul',hour,minute,confirmed}`. 생략하면 09:00 KST 잠정값이며 `confirmed:false`로 활성화 불가.

`marketing`은 저장해 검토 상태를 표시할 수 있으나 이 어댑터가 자동 발송하지 않습니다. 광고 표기·수신거부 등 별도 준수 검토와 적절한 카피가 필요합니다. 지원하는 두 non-marketing 분류도 프로그램이 판단하거나 자동 승인하지 않으며 명시적 개별 근거가 필요합니다.

## 수신자별 검토

`reviewRecipient(owner, {expectedRevision, creatorKey, recipient, status, kind, classification, classificationSource, sourceUrl, sourceText, verifiedAt, expiresAt, approvalSource})`는 명시적으로 검토한 수신자만 저장합니다.

- `creatorKey`는 `youtube:UC…` 또는 `instagram:handle`이며 대소문자를 보존합니다.
- `kind`는 분류에 맞는 `solicited_proposal` 또는 `documented_business_proposal`만 허용합니다. `public_business_email`은 근거가 아닙니다.
- 승인자 owner, 정책 revision, immutable snapshot ID/hash는 서버에서 고정합니다.
- 출처·원문·30일 내 검토·미래 만료와 현재 수신자를 요구합니다.
- 템플릿/사진/제품/서명 범위가 바뀌면 기존 검토는 발송 권한이 되지 않습니다.
- `status:'revoked'`는 기존 검토를 취소하는 경로입니다. 일반 공개 연락처 수집과 이 검토는 분리됩니다.

## 기본 비활성, 당일 처리, 결과 불명 시 재발송 금지

다음 네 환경 플래그가 모두 명시적으로 `true`일 때만 설정/발송 작업자가 진행합니다.

```text
CREATOR_DAILY_CONFIGURATION_ENABLED
CREATOR_DAILY_DISPATCH_ENABLED
CREATOR_DAILY_SCHEDULER_ENABLED
EMAIL_SENDING_ENABLED
```

환경 플래그만으로 반복 작업이 등록된 것은 아닙니다. `recurringTriggerVerified`는 기본 `false`이며 실제 바인딩을 검증하는 콜백이 제공된 경우에만 `true`를 표시합니다. `schedulerEnabled`는 이 검증까지 요구합니다. `sendingEnabled`는 내부 작업자의 현재 사용 가능 상태입니다.

`schedule(owner,{expectedRevision})`는 SQL 정책의 시작 시각을 서버 현재 시각으로 정하고 같은 요청의 재시도에서 시작 시각을 바꾸지 않습니다. 과거 준비 후보, 과거 날짜, 만료된 근거를 가져오지 않습니다. `run(owner)`는 KST 지정 시각 이후 당일 큐만 bounded 처리합니다. 기본 한 번에 2개/20초의 처리 예산이므로 운영 반복 주기는 목표와 Gmail 비용/쿼터를 검토하여 별도 설정해야 합니다. 최대 60개/45초도 개별 공급자 호출을 강제로 잘라낼 수는 없으며 모든 발송 직전 신선도·lease 검사가 계속 적용됩니다.

Gmail 전체 검색에는 spam/trash가 포함됩니다. 두 번의 이력 검사 사이에 예약을 만들고, 두 번째 이력 후 SQL이 모든 근거와 제외·회신·수신거부·기존 예약을 재검사해 최대 15초 일회성 grant를 발급합니다. 실제 만료는 후보·수신자 근거·독립 출처 검토·공개 연락처 관찰의 남은 유효기간보다 길 수 없습니다. Gmail 점/플러스/googlemail 별칭은 도메인 전체의 최대 100개 메타데이터를 10초 예산으로 확인합니다. 목록이 더 크거나 결과가 불완전하면 검토 보류하며 clear로 간주하지 않습니다.

- `accepted`: Gmail이 반환한 message ID와 thread ID를 저장한 상태. 수신함 도착·열람을 뜻하지 않습니다.
- `rejected`: 확인 가능한 공급자 거절. 자동 재시도하지 않습니다.
- `outcome_unknown`: 전송/예약/grant/결과 저장이 불명확한 상태. 자동 재발송하지 않습니다.
- `cancelled`: 일회성 grant 전 검사 변경으로 미발송 취소한 상태.

lease가 만료된 processing 행은 재claim하지 않습니다. reserved/unknown/accepted 상태는 자동 재전송 큐가 되지 않습니다. 공급자 수락 후 결과 저장이 실패하면 원장을 다시 확인하되 이미 발송한 작업을 반복하지 않습니다.

## 최신 출처 검증

준비 후보 자체를 최종 근거로 신뢰하지 않습니다. 네이티브 YouTube/Instagram 원본, 같은 원본 읽기에서 얻은 version/updated, 현재 제외 상태를 예약과 최종 grant에서 다시 확인합니다. 공급 계층의 `candidateResolver`는 성공한 경우에도 이 검증을 대체하지 않습니다.

새 YouTube 공급 후보는 최신 API snapshot과 독립적으로 검토한 이름·프로필·먹방·연락처 근거가 모두 필요합니다. 독립 검토 시각과 해당 필드의 해시를 두 검사 사이에 고정합니다. API 제목·수치·활동 필드는 이 영구 해시에 넣지 않습니다.

기존 Instagram 추가 검토는 `sanji_daily_supply_instagram_reviews`의 최신 native updated와 정확히 일치해야 합니다. 검토가 만료·삭제된 후에도 최소 native-ID guard가 남아 예전 native 연락처로 되돌아가지 못하게 합니다. 원본 status/entity/link/assessment 제외 조건은 검토로 덮어쓸 수 없습니다.

공개 이메일 자동 보강은 최신 `sanji_contact_observations` publication과 전체 최신 `sanji_contact_source_versions`를 읽어 기존 연락처 근거에 합칩니다. 출처 정책·소속·완전한 version 집합·유효기간을 확인하고, 더 최근의 부정적 관찰이나 취소는 발송을 막습니다. Instagram bio는 실제 최신 native 관찰도 다시 읽습니다. publication ID/hash를 예약과 grant에 고정하며, 이 공개 근거는 수신자별 법적 근거를 생성하거나 대체하지 않습니다.

수신자 근거가 없어서 첫 처리에서 보류된 행은 명시적인 동일 정책·snapshot 검토를 받은 경우에만 당일·fresh·cutover 이후이며 예약/발송 흔적이 전혀 없는 행을 다시 큐에 넣습니다. 결과 불명·수락·거절·보안 보류는 이 경로로 재발송하지 않습니다.

## 본문과 보존

기존 `inline-mail.mjs`를 재사용하고, 서버 PNG 무결성 검사를 추가합니다. `[채널명]` 외의 원문은 바꾸지 않으며 본문 뒤, 기존 Gmail 서명 바로 위에 원본 PNG 두 장을 CID `multipart/related`로 넣습니다. 일반 attachment는 0개이고 서명은 정확히 1회입니다. PNG는 chunk 순서·CRC, 실제 IDAT 압축 데이터, 픽셀 행 길이와 필터를 확인합니다. 원본과 같은 비인터레이스 8-bit RGB/RGBA만 허용하고 압축 해제 크기를 제한합니다. 이메일 앱 자체가 인라인 사진에 첨부 표시를 붙일 수는 있습니다.

API 숫자·활동·원본 API 제목은 영구 queue/audit/native 후보에 복사하지 않습니다. API에서만 얻은 제목은 별도의 독립적 이름 출처 검토 없이 영구 개인화 메일에 사용하지 않습니다. 부모 준비/공급 계층이 API 자료 만료·삭제를 관리하며 발송 어댑터는 그 기한을 다시 확인합니다.

## 로컬 검증

```sh
node --test tests/creator-daily-campaign.test.cjs tests/creator-daily-campaign-sql.test.cjs tests/creator-daily-inline-mail.test.cjs
```

테스트는 합성 PNG/가짜 연결, mock HTTP, 로컬 PGlite만 사용합니다. 원본 PNG 두 장은 별도로 로컬 검증했고 공개 코드에는 포함하지 않습니다. SQL 테스트는 실제 pending 준비/캠페인 SQL과 native/공급/연락처 schema fixture를 사용합니다. 전체 앱 및 실제 pending 공급·연락처 schema 조합 검증은 통합 단계에서 별도로 실행합니다.

2026-11-09 운영 `pg_catalog`/`information_schema` 읽기 전용 확인으로 native records/outbox/drafts/recovery/evidence/connections/suppression/audit의 참조 열·형식, owner lock/차단 helper, service_role 권한, insert 관련 trigger와 고유 index를 대조했습니다. `sanji_creator_evidence`는 id가 없는 복합 PK이며 native company/email/handle 고유 제약을 보존합니다. 출처는 기존 `202610210001_workspace.sql`, `202610270001_creator_recovery.sql`, `202610290002_creator_proposal_guard.sql`, `20261104073138_creator_email_isolated.sql` 및 현재 catalog입니다. 행 데이터·인증정보는 이 검증에서 읽지 않았습니다. 운영 insert smoke test는 하지 않았습니다. 운영 SQL·Gmail 동작·실제 배포·반복 트리거 확인의 대체가 아닙니다. SQL을 운영에 적용하기 전에 그 시점의 schema drift, Supabase 보안 advisors, 전체 pending SQL 적용 및 실제 서비스 client의 호출 권한을 별도 확인해야 합니다. 필요한 순서는 준비 SQL, 공급/독립 검토/Instagram 추가 검토 및 연락처 보강 SQL, 이 캠페인 SQL입니다. 이 파일들은 자동 적용되지 않습니다.
