/**
 * 관제 화면 설정
 * URL 파라미터로 덮어쓸 수 있음:
 *   index.html?mode=mock                         → 백엔드 없이 목업 시뮬레이션
 *   index.html?mode=live&api=http://10.0.0.5:8002 → 다른 주소의 detector에 붙기
 *   mode 생략(auto) → detector 연결 시도, 실패하면 목업으로 대체
 */
window.MIKKI_CONFIG = (function () {
  var cfg = {
    // detector 관제 API. 기본은 화면을 연 호스트의 8002 포트
    apiBase: location.protocol === 'file:'
      ? 'http://localhost:8002'
      : location.protocol + '//' + location.hostname + ':8002',
    mode: 'auto',          // 'auto' | 'live' | 'mock'
    probeTimeoutMs: 1500,  // auto 모드에서 detector 확인 대기
    mockStepMs: 650,       // 목업 요청 간격
    maxLogRows: 800        // 로그에 남길 최대 줄 수
  };
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('mode')) cfg.mode = q.get('mode');
    if (q.get('api')) cfg.apiBase = q.get('api').replace(/\/$/, '');
    if (q.get('step')) cfg.mockStepMs = Math.max(50, parseInt(q.get('step'), 10) || cfg.mockStepMs);
  } catch (e) { /* 무시 */ }
  cfg.wsUrl = cfg.apiBase.replace(/^http/, 'ws') + '/ops/stream';
  return cfg;
})();
