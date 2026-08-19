# TideFinder - Vite 모듈화 (1단계 완료)

## 로컬에서 실행하기
```bash
npm install
npm run dev       # http://localhost:5173 에서 개발 서버 실행
npm run build     # dist/ 에 프로덕션 빌드 생성
```

## 배포 전 반드시 해야 할 일
1. `public/coastline-korea.geojson.gz.PLACEHOLDER` → 기존 저장소의 진짜 파일로 교체 (확장자 .PLACEHOLDER 제거)
2. `public/setnet-korea.geojson.PLACEHOLDER` → 기존 저장소의 진짜 파일로 교체
3. `netlify/functions/weather.js` → 기존 저장소의 진짜 파일로 덮어쓰기 (지금은 501 반환하는 더미)
4. Netlify 배포 설정에서 Build command를 `npm run build`, Publish directory를 `dist`로 지정

## 이번 단계에서 아직 안 옮겨진 기능 (다음 턴에 이어서 진행)
- ROMS/HF 비교 브리핑 카드 (`fetchAndRenderRomsInfo`, `fetchAndRenderHFCurrent`)
- 정치망 인접 경고 마커 렌더링
- 상황 보고서 클립보드 복사 (`copyOperationReport`)
- CoastView(3D 지형) 새 탭 열기
- 현재 해상 상태 카드(수온/기온/파고 등) 자동 갱신

이 기능들은 코드가 어디로 가야 할지는 이미 구조가 잡혀 있습니다
(api.js에 fetch 함수 추가 -> ui.js에 렌더 함수 추가 -> main.js에서 연결).
"다음 단계 진행해줘"라고 하시면 이어서 완성해드립니다.
