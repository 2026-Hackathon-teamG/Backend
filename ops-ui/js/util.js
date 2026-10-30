/** 공용 헬퍼. agent_note, path 같은 값은 공격자가 정하는 문자열이므로 반드시 esc()를 거쳐 그립니다. */
window.U = {
  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  },

  num: function (n) { return Number(n || 0).toLocaleString('ko-KR'); },

  // 초 → "3분 12초"
  dur: function (sec) {
    sec = Math.round(Number(sec) || 0);
    if (sec < 60) return sec + '초';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + '분 ' + s + '초';
    return Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
  },

  // ISO → "HH:MM:SS"
  time: function (iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return '--:--:--';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  },

  debounce: function (fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  },

  store: {
    get: function (k, fallback) {
      try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경이면 무시 */ }
    }
  }
};
