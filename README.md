# TideFinder - AI 기반 해양 수색지원 시스템

조류·바람 데이터로 해상 표류자/표류물의 이동을 예측하고 수색구역을 제시하는 웹앱.
Vite로 빌드하고, GitHub `main`에 푸시하면 Netlify가 자동 배포한다.

## 로컬 실행
```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # dist/ 에 프로덕션 빌드
```
로컬 개발 중 `/.netlify/functions/*` 요청은 배포된 사이트의 함수로 우회된다(vite.config.js).

## 구조
- `index.html` - 화면(스타일 포함)
- `src/main.js` - 초기화, 버튼 연결, 상황 보고서 복사, 서비스워커 등록
- `src/predict.js` - 표류 예측 파이프라인, 예측 신뢰도 계산
- `src/modules/` - api(외부 API), map(카카오맵), coastline(해안선·정치망), montecarlo, marine(해상상태 카드), ui,
  sealayers(어장·간출암 지도 레이어, 항로 위험 판정), eta(출동 거리·도착 예정시각),
  route(해상 항로 계산 - 격자 A*로 육지를 돌아가고 정치망·양식장·간출암·얕은 곳 회피),
  depth(얕은 수심 - 함수 mode=shallow로 0.1° 타일 단위, 수심 10m 이하 점만 받아 지도 색칠·항로 회피에 사용)
- `src/worker.js` - 몬테카를로 500입자 시뮬레이션(Web Worker)
- `netlify/functions/weather.cjs` - 공공 API 프록시(수심 `mode=shallow`는 국립해양조사원 자연과학용 수심 150m 격자, 키는 `TW_SERVICE_KEY`, CDN 30일 캐시)(서비스키는 Netlify 환경변수 `SERVICE_KEY`, `KHOA_SERVICE_KEY`, `TW_SERVICE_KEY`, `KMA_APIHUB_KEY`)
- `public/` - 해안선(`coastline-korea.geojson.gz`), 정치망(`setnet-korea.geojson`, 표류 경고용 전국),
  어장(`fishery-pohang.geojson`, 지도 표시용 포항·경주·영덕 정치망·양식·마을어업 면허구역), 동해안 육지(`land-east.geojson`, 통계청 시군구 경계 2013 기반 - 전자해도 해안선 자료에 포항~영덕(북위 36.22° 이남)이 빠져 있어 항로 계산용으로 보완), 간출암(`rocks-pohang.geojson`, 해양수산부 간출암 2025-01 배포본 포항~영덕 23개), 아이콘, 매니페스트, 서비스워커(`sw.js`)

## 예측 방식 요약
1. 해류: HF 레이더 실측(커버리지 안) → 없으면 KHOA 조류예측 격자
2. KHOA 시간별 조류 예측은 항상 받는다(동시 6건씩). HF를 쓴 경우 0~1시간은 HF,
   2·3시간째에 KHOA로 점차 전환, 4시간째부터 KHOA만 사용 - 조류 방향 전환 반영
3. 바람·파고: Open-Meteo 해상 격자 예보(키 불필요, 브라우저 직접 호출, `cell_selection=sea`) 우선,
   실패 시 기상청 단기예보(육상 격자) 폴백. 바람 × 풍압계수, 파고는 오차반경에 반영
   - Open-Meteo는 비상업적 이용 무료, 출처표시 필요(화면 하단 표기). Open-Meteo의 기상청 모델 피드는
     기상청 모델 교체(2026-03)로 중단 상태라 기본 best_match 모델을 사용
   - 기상청 API허브 해양 종합 관측(`sea_obs.php`, 해양기상부이·파고부이·등표) 실측이 50km 이내에 있고
     사고 시각이 현재와 90분 이내면: 파고는 실측값, 바람은 0~1시간 실측 → 2·3시간째 예보로 전환.
     키는 Netlify 환경변수 `KMA_APIHUB_KEY`(서버 함수에서만 사용, 응답 EUC-KR → 함수에서 JSON 변환)
4. 해안선에 닿으면 좌초 처리, 정치망 300m 이내 접근 시 경고
5. 예측 신뢰도(추정): 자료 출처·누락, 예측 시간, 해안선 로드 여부로 감점하는 현장 판단용 지표
   (통계적 확률 아님). 감점 사유가 화면에 함께 표시된다.

## 오프라인 동작 (public/sw.js)
- 한 번 접속하면 화면·스크립트·해안선·정치망 데이터가 폰에 저장되어, 신호가 끊겨도 앱이 열리고 예측이 돈다.
- 조류·기상 API 응답은 저장하지 않는다(오래된 값을 최신처럼 보여주지 않기 위함) - 오프라인에선 기본값 계산이 되고 신뢰도가 낮게 표시된다.
- 카카오맵은 외부 서비스라 오프라인에선 안 뜬다. 지도 없이도 좌표 직접 입력으로 예측 가능.
- **해안선/정치망 파일을 교체하면 `public/sw.js`의 `CACHE_VERSION`을 올릴 것** (안 올리면 폰에 옛 데이터가 남음).

## 카카오맵 키
- 지도 SDK는 `src/modules/map.js`에서 동적으로 불러온다. Netlify 환경변수 `VITE_KAKAO_KEY`를 먼저 쓰고,
  거부되면 기존 키로 다시 시도한다. 환경변수를 바꾸면 재배포해야 반영된다(빌드 시 코드에 들어감).

## 주의
- `netlify/functions/`의 함수는 CommonJS(`require`)라 확장자가 `.cjs`여야 한다
  (package.json이 `"type": "module"`이라 `.js`면 Netlify 빌드가 실패함).

## 남은 과제
- 오차반경 공식(50m + 이동거리 비례 + 횡풍 발산)의 실제 사례 검증
