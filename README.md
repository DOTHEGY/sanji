# 산지 · 공동구매 영업 워크스페이스

브랜드·유통사 발굴부터 상품 딜·크리에이터 매칭·승인 제안·답장까지 관리하는 Node.js 24 / SQLite 웹서비스입니다.

- **공개 체험:** https://dothegy.github.io/sanji/ — 가상 데이터 데모, 실제 발송 없음
- **운영 시작 안내:** https://dothegy.github.io/sanji/operate.html
- **실제 운영 코드:** `api/`, `private/ui/`, `server.cjs`. 별도 서버 배포 및 외부 계정 연결 필요. 운영 DB에는 가상 데이터 없음.

## 실행

```sh
npm ci --cache /tmp/sanji-npm-cache
DATA_DIR=/tmp/sanji-local npm start
```

루트에서 `/app/`으로 이동합니다. 첫 실행은 DATA_DIR의 비공개 `setup.token` 또는 SANJI_SETUP_TOKEN으로 초기 관리자 계정을 생성합니다. 생성 후 가입은 닫힙니다. 서버 운영 필수 설정과 Gmail/Meta 공식 인증 방법은 [운영 안내](docs/PRODUCTION.md)를 확인하세요. 외부 서비스 비밀번호를 입력하지 않습니다.

```sh
npm test
```

Chromium이 `/usr/bin/chromium`에 있어야 합니다. 다른 경로는 CHROMIUM_PATH로 지정합니다. 테스트는 독립 임시 DB/서버를 생성하며 실제 외부 발송은 하지 않습니다. Gmail 공급자는 모의 응답으로 검증합니다.

## 배포

`render.yaml`로 Render의 단일 서버·영구 디스크를 준비할 수 있습니다. **유료 플랜 선언이며 계정 연결·가격 확인·별도 비용 승인 후에만 생성하세요. 아직 운영 서버를 배포하지 않았습니다.** 실발송 플래그는 기본 false입니다. 실제 발송하려면 공식 Gmail/Meta 계정 연결, 서버 발송 활성화, 각 최종 수신자·내용 승인이 필요합니다.

GitHub Pages 워크플로는 `public/`만 배포합니다. 실제 운영 UI·DB·서버 코드·시크릿을 Pages에 복사하지 마세요. 실제 영업 자료는 인증 API 뒤에서 관리합니다.

구현 범위, 확인한 정책, 외부 연동 미검증 항목 및 운영 한계는 [docs/PRODUCTION.md](docs/PRODUCTION.md)에 명시했습니다. 이전 데모 설명은 [docs/OPERATIONS.md](docs/OPERATIONS.md)에 있습니다.
