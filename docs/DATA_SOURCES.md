# 데이터·오픈소스 연결 현황

확인일: 2026-10-17. 연계됐다는 사실과 현장 정확도 검증은 별개입니다.

| 자료 | 현재 연결 | 용도·제약 |
|---|---|---|
| KHOA 수치조류도 | 시간·이동 위치별 API | 주 표류 입력, cm/s → m/h. 최근접 격자점 15km 초과 시 사용 거부 |
| 기상청 단기예보 | 기존 프록시 | 원점 격자의 시간별 바람, 시각 차 60분 초과 값 사용 거부 |
| KHOA HF레이더 | 실측 카드·독립 비교 | 관측 시각·실제 관측점 거리 확인. 미래 외삽하지 않음 |
| KHOA ROMS | 별도 비교 버튼 | 유향·수온·격자 시각/거리 표시. 유속 단위 확정 전 주 예측에 미적용 |
| KHOA 조위·해양부이·해무 | 실측 카드 | 항목별 관측소·거리·시각 표시, 미수신 구분 |
| KHOA 만조·간조 | 기존 API | 오늘 제공 자료 중 다음 사건. 이후 자료 없으면 미확보 표시 |
| KHOA 항행경보 | 신규 XML 프록시 | 오늘 전국 발행 최대 100건. 현재 유효 전체나 반경 필터 아님 |
| 기상청 기상특보 | 최근 발표 카드 | 발표 목록이며 현재 발효 상태 자동 판정 안 함 |
| Open-Meteo Marine | 신규 보조모델 | 파고·너울·파주기·해류·표층수온·평균해수면 높이. 단위는 응답 메타데이터 사용 |
| Open-Meteo Weather | 신규 보조모델 | 시정·돌풍·강수·일출몰. 관측값이 아닌 예보 |
| 기상청 해양기상부이·국립수산과학원 | 공식 바로가기 | 별도 공식 관측 확인 |
| 해양경찰청 인명 통계 | 공식 자료 바로가기 | 연간 통계, 실시간 사고 위치·진행 정보 아님 |
| 기존 CCTV | 기존 링크 유지 | 영상 제공기관의 화면에서 확인 |

## 공식 자료
- ROMS: https://www.data.go.kr/data/15142227/openapi.do (공공누리 제1유형 출처표시)
- 수치조류도: https://www.data.go.kr/data/15039006/openapi.do
- 항행경보: https://www.data.go.kr/data/15057792/openapi.do
- 해양경찰 인명 통계: https://www.data.go.kr/data/15104130/fileData.do
- 기상청 부이: https://www.weather.go.kr/w/obs-climate/sea/buoy-obs.do
- 관측자료 공식 안내: https://www.nifs.go.kr/kodc/ocean-info/website/realtime-observation
- 보조 해양모델 명세: https://open-meteo.com/en/docs/marine-weather-api
- 보조 기상모델 명세: https://open-meteo.com/en/docs

Open-Meteo 자료: Open-Meteo, DWD, Météo-France, Copernicus, ECMWF 등 공급자 출처를 표시합니다. 자료 CC BY 4.0과 공개 API의 비상업 사용조건은 별도로 적용됩니다. 해류·해수면은 약 8km 광역 모델이므로 연안 국지 정확도가 제한됩니다. 평균해수면(MSL) 기준 높이는 해도 기준 조위로 바꾸어 표시하지 않습니다. 자료 수신 시각과 모델 예측 대상 시각도 구분합니다.

## 오픈소스
- Leaflet 1.9.4, BSD-2-Clause: https://leafletjs.com/download.html — 지도, 레이어, 시간 위치 표시.
- Turf 6.5.x, MIT: https://github.com/Turfjs/turf — 경계상자·정치망 거리·입자 외곽·GeoJSON 수색구역.
- OpenStreetMap 데이터/타일: https://www.openstreetmap.org/copyright / https://operations.osmfoundation.org/policies/tiles/ — 화면에 출처 표시. 타일 대량 다운로드·오프라인 사전 저장 기능은 제공하지 않음. 대규모 운용은 전용 타일 공급자 필요. `VITE_TILE_URL`을 바꾸면 해당 공급자의 attribution도 map.js에서 함께 설정해야 함.
- OpenDrift Leeway 참고: https://opendrift.github.io/autoapi/opendrift/models/leeway/index.html — SAR 모델·계수 참고. GPLv2 Python 엔진을 이 JavaScript 앱에 복사하거나 이식하지 않았으며 OpenDrift와 동등한 성능을 주장하지 않음.

배포에 포함되는 Leaflet/Turf 저작권 고지는 `public/THIRD_PARTY_NOTICES.txt`에 보존합니다. 기존 해안선·정치망 데이터의 원출처·버전·이용허락은 저장소에서 확인되지 않아 검증 완료로 표시하지 않았습니다.

## 아직 연결하지 않은 정보
AIS/VTS 실시간 선박 위치, 개인별 사고 원장, 기관 내부 출동정보는 공개 접근이 확인되지 않았으므로 임의 수집·생성하지 않습니다. 수심·해도·항만시설·과거 사고 좌표는 원자료 라이선스·좌표계·갱신 주기를 확인한 뒤 별도 레이어로 확장해야 합니다. 서버형 OpenDrift와 수심별 해류 입력은 후속 연구 범위입니다.
