# Render 서버 실행기

현재 릴리스는 **프로필 자동 확인 + 별도 승인된 내부 테스트 DM 1건**입니다. 일반 크리에이터 대상 서버 DM은 비활성입니다. 테스트는 `valu_est → taemin_dtg`의 승인된 정확한 문구만 허용하며, 클릭 이후 결과 미확인 건을 자동 재시도하지 않습니다. PC 실행기의 수동 확인 방식은 유지됩니다. 서버 이전으로 계정 제한 위험이 없어지는 것은 아닙니다.

## Render 입력

New → Background Worker → DOTHEGY/sanji → main.

| 항목 | 값 |
|---|---|
| Name | sanji-instagram-worker |
| Language / Runtime | Docker |
| Root Directory | 비움 |
| Dockerfile Path (Advanced) | server-worker/Dockerfile |
| Docker Build Context | 저장소 루트 (`.`) |
| Docker Command | 비움 (Dockerfile CMD 사용) |
| Build / Start Command | Node의 yarn / npm run start 사용하지 않음 |
| Region | Oregon 유지 가능 |
| Instances | 1 |
| Auto Deploy | Off 권장 |
| Compute | Chromium 여유 메모리를 위해 2GB 권장. 현재 생성 화면 기준 $25/월, 세금 별도. 결제 전 Render 최종 금액 확인 |

512MB $7 플랜은 메모리 부족 위험이 있어 권장하지 않습니다. 무료 Supabase Edge Functions는 이 상주 Chromium 실행기를 대체하지 못합니다. 유료 생성은 운영자가 비용을 확인한 후 진행하세요. 기존 루트 render.yaml은 이번 Instagram 실행기에 사용하지 않습니다.

## 환경 변수와 시작

1. 산지 → 크리에이터 발굴 → 서버 Instagram 실행기 → **Render 서버 키 발급**.
2. Render Environment Variables에 `SANJI_SERVER_KEY` = 방금 발급한 서버 키, `SANJI_SENDER_HANDLE` = `valu_est` (@ 제외).
3. Supabase service_role 키, Google 비밀 키, Instagram 비밀번호는 Render에 넣지 않습니다. 서버 키는 30일 유효하며 새 키 발급 시 기존 키가 폐기됩니다.
4. PC에서 본인 로그인·계정 확인 후 DB 세션 백업을 한 번 저장합니다. 기존 유효 세션이 있으면 재로그인이 필요하지 않습니다. 세션은 7일 뒤 만료됩니다.
5. 비용 확인 후 Deploy Background Worker. 산지에서 **서버 재개**를 누릅니다. 최초 배포만으로 조회를 시작하지 않습니다.
6. Render 로그의 `DB 세션·발신 계정 확인 완료` 및 산지의 서버 상태를 확인합니다. 미리보기 하루 최대 50명, 간격 최소 30초. 후보 검색 하루 50명과 다릅니다. PC를 끄면 서버 조회는 계속되지만 추가 인증에는 PC가 필요합니다.

## 추가 인증 / 제한 / 복구

로그인 요구·계정 불일치·제한 화면이면 브라우저를 닫고 자동 재시작하지 않습니다. Render 재시작만으로 인증을 재시도하지 않습니다.

산지에서 PC 키를 새로 발급 → PC 실행기를 미리보기 모드 `npm start`로 실행 → Instagram 공식 화면에서 직접 인증 → DB 백업 저장 완료 확인 → 산지 서버 재개. 이전 인증 실패 이후 저장된 새 세션이 아니면 재개를 거부합니다. PC 키 재발급은 서버 키에 영향을 주지 않습니다.

일시중지는 산지의 서버 일시중지 버튼. 즉시 프로세스 종료는 Render Suspend. 연결 해제는 서버 키 폐기. 되돌릴 때 Render를 중지하고 기존 PC 실행기만 사용하면 됩니다. 기존 대화·승인·발송 이력은 삭제하지 않습니다. 실패/결과 미확인 DM은 자동 재시도하지 않습니다.

## 보안·검증 범위

서버 키는 계정에 묶인 전용 키로 Supabase에서 해시만 저장합니다. 로그인 상태는 기존 서버 암호화 저장소에서 HTTPS로 복원해 임시 브라우저 메모리에서 사용합니다. Render 디스크에 로그인 폴더를 저장하지 않습니다. 로그인 상태와 키는 로그에 출력하지 않습니다. DB lease로 서버 중복 실행을 제한합니다.

코드·로컬 검증과 Render에서의 실제 로그인 검증은 별개입니다. Render 배포 전에는 서버에서 Instagram 로그인이 성공했다고 간주하지 마세요. 서버의 일반 대상 자동 DM은 이번 릴리스 범위에 없습니다. 내부 테스트 결과와 전달·열람 확인은 별도로 구분합니다.

## 백그라운드 검색 (server-background-v3)

Render 실행기가 5분마다 기존 무료 검색 수집기를 호출합니다. 검색이 켜져 있을 때만 실행하고 하루 신규 후보 목표(현재 50명), 중복·수신 거부 제외, 동시 실행 방지는 기존 서버 규칙을 따릅니다. 검색 실패는 프로필 확인이나 메일 기능을 중단시키지 않습니다. DM은 별도 승인된 내부 테스트만 처리합니다. Render를 `Deploy latest commit`으로 갱신한 뒤 산지에서 `server-background-v3` 표기를 확인하세요. 웹 페이지를 새로고침하는 것만으로 Render 실행기가 업데이트되지는 않습니다.

## 서버 종료·복구 구분 (server-background-v4)

Render의 정상 종료(SIGTERM)는 브라우저를 닫되 계정을 인증 실패 상태로 바꾸지 않습니다. 브라우저 종료·일시 네트워크 오류는 최대 시간당 2회, 60초 간격으로 복구합니다. 실제 `/challenge/`, 로그인·계정 제한 화면이면 중지하며 자동 재인증하지 않습니다. 상태 화면에는 마지막 확인 시각과 중지·복구·한도·응답 없음이 구분됩니다. 기존 후보는 미확인 건부터 오래된 순서로 처리합니다.
