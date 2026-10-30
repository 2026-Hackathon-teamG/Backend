/**
 * 대시보드 설정
 * URL 파라미터로 덮어쓸 수 있음:
 *   index.html?mode=mock              → 백엔드 없이 목업 시뮬레이션
 *   index.html?mode=live&api=http://localhost:8000
 *   mode 생략(auto) → 백엔드 연결 시도, 실패하면 목업으로 대체
 */
window.REDI_CONFIG = (function () {
  var cfg = {
    apiBase: '',          // 같은 서버(FastAPI StaticFiles)에서 서빙하면 빈 문자열
    mode: 'auto',         // 'auto' | 'live' | 'mock'
    pollMs: 1000,         // 백엔드 폴링 간격
    mockStepMs: 900       // 목업 재생 속도 (이벤트 1개당)
  };
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('mode')) cfg.mode = q.get('mode');
    if (q.get('api')) cfg.apiBase = q.get('api').replace(/\/$/, '');
    if (q.get('poll')) cfg.pollMs = Math.max(250, parseInt(q.get('poll'), 10) || cfg.pollMs);
  } catch (e) { /* 무시 */ }
  return cfg;
})();
