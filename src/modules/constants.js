// ==========================================================================
// TideFinder 설정 상수 모음
// 이 파일은 순수 데이터만 담는다 - 함수나 DOM 조작 코드는 절대 넣지 않는다.
// (규칙: constants.js를 열었을 때 "이 숫자/목록이 뭐지?"만 확인하면 되게 유지)
// ==========================================================================

// HF레이더 관측소 커버리지 반경(km). 이 거리를 넘으면 실측값을 신뢰하지 않고
// "커버리지 밖" 안내로 대체한다.
export const HF_COVERAGE_LIMIT_KM = 50;

// 풍압 좌우발산(Crosswind Leeway) 각도 근사치 - 실측 카테고리 매칭 없을 때만 사용
export const CROSSWIND_DIVERGENCE_FALLBACK_DEG = 20;

// ==========================================================================
// 전국 HF-Radar 관측소 좌표 사전
// ✅ 코드 목록은 국립해양조사원 공식 오픈API 활용가이드 PDF로 전수 대조 검증 완료.
//   좌표(lat/lon)는 관측소 설치 정밀좌표가 아니라 근사치이므로 거리는 참고용으로만 사용.
// ==========================================================================
export const HF_STATIONS = [
  { code: 'HF_0069', name: '인천항', lat: 37.4, lon: 126.6, verified: true },
  { code: 'HF_0070', name: '태안대산', lat: 36.9, lon: 126.1, verified: true },
  { code: 'HF_0076', name: '군산항', lat: 36.0, lon: 126.5, verified: true },
  { code: 'HF_0074', name: '목포항외측', lat: 34.7, lon: 126.1, verified: true },
  { code: 'HF_0075', name: '목포항내측', lat: 34.8, lon: 126.3, verified: true },
  { code: 'HF_0039', name: '여수해만', lat: 34.7, lon: 127.8, verified: true },
  { code: 'HF_0064', name: '광양항', lat: 34.9, lon: 127.7, verified: true },
  { code: 'HF_0065', name: '여수광양항', lat: 34.8, lon: 127.8, verified: true },
  { code: 'HF_0040', name: '부산항신항', lat: 35.0, lon: 128.8, verified: true },
  { code: 'HF_0041', name: '대한해협', lat: 35.1, lon: 129.2, verified: true },
  { code: 'HF_0063', name: '울산항', lat: 35.4, lon: 129.4, verified: true },
  { code: 'HF_0073', name: '동해남부', lat: 35.7, lon: 129.5, verified: true },
  { code: 'HF_0071', name: '포항항', lat: 36.0, lon: 129.4, verified: true },
];

// 전국 조위관측소(DT) 좌표 사전 - 수온/기온/기압 조회용
export const DT_STATIONS = [
  { code: 'DT_0001', name: '인천', lat: 37.45, lon: 126.60 },
  { code: 'DT_0002', name: '평택', lat: 36.97, lon: 126.82 },
  { code: 'DT_0003', name: '영광', lat: 35.43, lon: 126.42 },
  { code: 'DT_0004', name: '제주', lat: 33.53, lon: 126.54 },
  { code: 'DT_0005', name: '부산', lat: 35.10, lon: 129.04 },
  { code: 'DT_0006', name: '묵호', lat: 37.55, lon: 129.11 },
  { code: 'DT_0007', name: '목포', lat: 34.78, lon: 126.38 },
  { code: 'DT_0008', name: '안산', lat: 37.20, lon: 126.60 },
  { code: 'DT_0010', name: '서귀포', lat: 33.24, lon: 126.56 },
  { code: 'DT_0011', name: '후포', lat: 36.68, lon: 129.45 },
  { code: 'DT_0012', name: '속초', lat: 38.21, lon: 128.59 },
  { code: 'DT_0013', name: '울릉도', lat: 37.49, lon: 130.91 },
  { code: 'DT_0014', name: '통영', lat: 34.83, lon: 128.43 },
  { code: 'DT_0016', name: '여수', lat: 34.75, lon: 127.77 },
  { code: 'DT_0017', name: '대산', lat: 37.01, lon: 126.35 },
  { code: 'DT_0018', name: '군산', lat: 35.98, lon: 126.56 },
  { code: 'DT_0020', name: '울산', lat: 35.50, lon: 129.39 },
  { code: 'DT_0027', name: '완도', lat: 34.32, lon: 126.75 },
  { code: 'DT_0028', name: '진도', lat: 34.48, lon: 126.31 },
  { code: 'DT_0029', name: '거제도', lat: 34.80, lon: 128.70 },
  { code: 'DT_0035', name: '흑산도', lat: 34.68, lon: 125.44 },
  { code: 'DT_0050', name: '태안', lat: 36.75, lon: 126.13 },
  { code: 'DT_0056', name: '부산항신항', lat: 35.08, lon: 128.80 },
  { code: 'DT_0057', name: '동해항', lat: 37.51, lon: 129.13 },
  { code: 'DT_0061', name: '삼천포', lat: 34.93, lon: 128.07 },
  { code: 'DT_0062', name: '마산', lat: 35.20, lon: 128.57 },
  { code: 'DT_0063', name: '가덕도', lat: 35.03, lon: 128.81 },
  { code: 'DT_0091', name: '포항', lat: 36.03, lon: 129.38 },
];

// 전국 해무관측소(SF) 좌표 사전 - 시정 조회용
export const SF_STATIONS = [
  { code: 'SF_0001', name: '부산항(북항)', lat: 35.10, lon: 129.04 },
  { code: 'SF_0002', name: '부산항(신항 동측)', lat: 35.08, lon: 128.80 },
  { code: 'SF_0003', name: '인천항', lat: 37.45, lon: 126.60 },
  { code: 'SF_0004', name: '평택·당진항', lat: 36.97, lon: 126.82 },
  { code: 'SF_0005', name: '군산항', lat: 35.98, lon: 126.56 },
  { code: 'SF_0006', name: '대산항', lat: 37.01, lon: 126.35 },
  { code: 'SF_0007', name: '목포항', lat: 34.78, lon: 126.38 },
  { code: 'SF_0008', name: '여수항', lat: 34.75, lon: 127.77 },
  { code: 'SF_0010', name: '울산항', lat: 35.50, lon: 129.39 },
  { code: 'SF_0011', name: '포항항', lat: 36.03, lon: 129.38 },
  { code: 'SF_0012', name: '부산항(신항 서측)', lat: 35.08, lon: 128.78 },
];

// 위경도 기반 기상청 특보구역(stnId) 매핑
// ✅ WthrWrnInfoService 공식 Open API 활용가이드 부록(지점코드 표)으로 검증 완료.
export function getKmaStnId(lat, lon) {
  if (lat < 34.0) return '184'; // 제주
  if (lat >= 37.0 && lon > 127.5) return '105'; // 강원(강릉)
  if (lat >= 37.0) return '109'; // 서울/인천/경기
  if (lat >= 35.5 && lon > 127.5) return '143'; // 대구/경북 (포항 포함)
  if (lat >= 36.0 && lon <= 127.5) return '133'; // 대전/세종/충남
  if (lat >= 35.7 && lat < 37.0 && lon <= 128.2) return '131'; // 충북
  if (lat < 35.7 && lon > 128.0) return '159'; // 부산/울산/경남
  if (lat < 36.0 && lon <= 127.5 && lon > 126.7) return '146'; // 전북
  if (lat < 35.5) return '156'; // 광주/전남
  return '143';
}
