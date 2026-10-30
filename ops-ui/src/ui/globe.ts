/**
 * 공격 지도 지구본: 출발지 → 실서비스 또는 미끼망(허니팟)으로 호를 그린다.
 * globe.gl(three.js)은 무거워서 처음 그릴 때 따로 불러온다. WebGL이 없으면 목록만 보인다.
 *   실서비스로 가는 공격 → 빨강(정찰은 보라), 미끼망으로 간 요청 → 호박색. 진행 중이면 흐르는 점선
 *   현재 라운드 차단 검증 → 초록 실선 / 지난 라운드 → 회색
 *   같은 공격자의 IP끼리 → 묶음 확정은 진한 점선, 추정은 흐린 점선
 * src_geo가 없으면 src_ip를 해시해 가상 도시에 둔다 (화면에 가상이라고 적는다).
 * 공격 주체 카드로 타임라인을 거르면 지구본도 그 주체 것만 보인다.
 */
import type { GlobeInstance } from 'globe.gl';
import type { Actor, DashboardState, Dest, Geo, RediEvent } from '../types';
import { $, changed, esc, view } from './shared';

const DEFAULT_REAL: Geo = { lat: 37.57, lon: 126.98, city: '서울', country: 'KR' };
const DEFAULT_DECOY: Geo = { lat: 33.5, lon: 126.53, city: '제주', country: 'KR' };
const COLOR = {
  attack: '#F2665C', recon: '#A78BFA', decoy: '#E9A23B', blocked: '#4CC38A', real: '#45C0CF',
  old: 'rgba(142, 156, 151, .3)', link: 'rgba(230, 236, 233, .7)', guess: 'rgba(230, 236, 233, .22)'
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** IP 해시용 가상 도시 */
const HASH_CITIES: Geo[] = [
  [52.37, 4.90, '암스테르담', 'NL'], [50.11, 8.68, '프랑크푸르트', 'DE'], [51.51, -0.13, '런던', 'GB'],
  [48.86, 2.35, '파리', 'FR'], [52.23, 21.01, '바르샤바', 'PL'], [44.43, 26.10, '부쿠레슈티', 'RO'],
  [41.01, 28.98, '이스탄불', 'TR'], [25.20, 55.27, '두바이', 'AE'], [19.08, 72.88, '뭄바이', 'IN'],
  [1.35, 103.82, '싱가포르', 'SG'], [22.32, 114.17, '홍콩', 'HK'], [35.68, 139.69, '도쿄', 'JP'],
  [-33.87, 151.21, '시드니', 'AU'], [39.04, -77.49, '애슈번', 'US'], [41.88, -87.63, '시카고', 'US'],
  [34.05, -118.24, '로스앤젤레스', 'US'], [43.65, -79.38, '토론토', 'CA'], [-23.55, -46.63, '상파울루', 'BR'],
  [6.52, 3.38, '라고스', 'NG'], [-26.20, 28.05, '요하네스버그', 'ZA']
].map(([lat, lon, city, country]) => ({ lat, lon, city, country }) as Geo);

interface Arc {
  startLat: number; startLng: number; endLat: number; endLng: number; alt: number | null;
  color: string; stroke: number; dash: number; gap: number; animate: number; label: string;
}
interface Point { lat: number; lng: number; color: string; r: number; label: string }
interface Ring { lat: number; lng: number; color: string; maxR: number }
interface Pin { lat: number; lng: number; el: HTMLElement }
interface Scene { arcs: Arc[]; points: Point[]; rings: Ring[]; pins: Pin[]; focus: { seq: number; geos: Geo[]; to: Geo } | null }

let globe: GlobeInstance | null = null;
let loading = false;
let pending: Scene | null = null;
let focusedSeq = 0;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

function makePin(cls: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `globe-pin ${cls}`;
  el.innerHTML = '<i></i><span></span>';
  return el;
}
const realPin = makePin('real');
const decoyPin = makePin('decoy');

const regionName = (() => {
  try {
    const dn = new Intl.DisplayNames(['ko'], { type: 'region' });
    return (code: string) => dn.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

const place = (g: Geo): string => [g.city, g.country].filter(Boolean).join(' ');

function hashGeo(ip: string): Geo {
  let h = 2166136261;
  for (let i = 0; i < ip.length; i++) h = Math.imul(h ^ ip.charCodeAt(i), 16777619);
  return HASH_CITIES[(h >>> 0) % HASH_CITIES.length];
}

/** 이벤트 출발지. virtual=true면 IP 해시로 정한 가상 위치 */
function originsOf(e: RediEvent): { geos: Geo[]; virtual: boolean } {
  if (e.src_geo?.length) return { geos: e.src_geo, virtual: false };
  if (e.src_ip) return { geos: [hashGeo(e.src_ip)], virtual: true };
  return { geos: [], virtual: false };
}

const destOf = (e: RediEvent): Dest => e.dest ?? (e.type === 'decoy_hit' ? 'decoy' : 'real');

function arcColor(e: RediEvent, s: DashboardState): string {
  if (e.round !== s.round) return COLOR.old;
  if (destOf(e) === 'decoy') return COLOR.decoy;
  const status = s.rounds.find((r) => r.round === e.round)?.status;
  if (status === 'verified') return COLOR.blocked;
  return e.type === 'recon' ? COLOR.recon : COLOR.attack;
}

/** 같은 공격자의 출발지를 첫 출발지에 잇는다. 격리됐거나 유사도 0.85 이상이면 확정, 아니면 추정 */
function actorLinks(actors: Actor[], events: RediEvent[]): Arc[] {
  const arcs: Arc[] = [];
  for (const a of actors) {
    const seen = new Map<string, Geo>();
    for (const e of events) {
      if (e.actor_id !== a.id) continue;
      for (const g of originsOf(e).geos) seen.set(`${g.lat},${g.lon}`, g);
    }
    const geos = [...seen.values()];
    if (geos.length < 2) continue;
    const sure = a.status === 'isolated' || (a.similarity ?? 0) >= 0.85;
    const label = `<b>${esc(a.id)}</b> · ${sure ? '같은 공격자로 묶음' : '추정 연결 (묶지 않음)'}` +
      (a.similarity != null ? `<br>유사도 ${esc(a.similarity.toFixed(2))}` : '') + `<br>출발지 ${geos.length}곳`;
    for (const g of geos.slice(1)) {
      arcs.push({
        startLat: geos[0].lat, startLng: geos[0].lon, endLat: g.lat, endLng: g.lon, alt: 0.04, label,
        color: sure ? COLOR.link : COLOR.guess, stroke: sure ? 0.3 : 0.18, dash: 0.02, gap: 0.015, animate: 0
      });
    }
  }
  return arcs;
}

function buildScene(s: DashboardState, events: RediEvent[], actors: Actor[]): Scene {
  const real = s.scenario.target_geo ?? DEFAULT_REAL;
  const decoy = s.scenario.decoy_geo ?? DEFAULT_DECOY;
  const arcs: Arc[] = [];
  const points = new Map<string, Point>();
  const recentSeq = new Set(s.events.slice(-3).map((e) => e.seq));
  const rings: Ring[] = [];

  for (const e of events) {
    const color = arcColor(e, s);
    const live = color === COLOR.attack || color === COLOR.recon || color === COLOR.decoy;
    const toDecoy = destOf(e) === 'decoy';
    const to = toDecoy ? decoy : real;
    const { geos, virtual } = originsOf(e);
    for (const g of geos) {
      const label = `<b>${esc(e.actor_id ?? '미식별')}</b> · ${esc(place(g))}${virtual ? ' (가상)' : ''}` +
        `<br>${esc(e.src_ip ?? '')}<br>→ ${toDecoy ? '미끼망' : '실서비스'} · 라운드 ${esc(e.round)} · ${esc(e.time)}`;
      arcs.push({
        startLat: g.lat, startLng: g.lon, endLat: to.lat, endLng: to.lon, alt: null, color, label,
        stroke: e.round === s.round ? 0.5 : 0.25,
        dash: live ? 0.35 : 1, gap: live ? 0.15 : 0, animate: live && !reduceMotion ? 1800 : 0
      });
      // 같은 위치는 점 하나로 (나중 이벤트 색이 이김)
      points.set(`${g.lat},${g.lon}`, { lat: g.lat, lng: g.lon, color, r: e.round === s.round ? 0.32 : 0.2, label });
      if (recentSeq.has(e.seq) && live) rings.push({ lat: g.lat, lng: g.lon, color, maxR: 3 });
    }
  }
  arcs.push(...actorLinks(actors, events));

  const last = s.events[s.events.length - 1];
  if (last?.type === 'breach') rings.push({ lat: real.lat, lng: real.lon, color: COLOR.attack, maxR: 6 });
  else if (last?.type === 'decoy_hit') rings.push({ lat: decoy.lat, lng: decoy.lon, color: COLOR.decoy, maxR: 6 });
  else if (last && ['rule_applied', 'verify', 'end'].includes(last.type)) rings.push({ lat: real.lat, lng: real.lon, color: COLOR.blocked, maxR: 6 });

  realPin.querySelector('span')!.textContent = `실서비스 · ${place(real)}`;
  decoyPin.querySelector('span')!.textContent = `미끼망 · ${place(decoy)}`;
  const newest = events[events.length - 1];
  return {
    arcs, points: [...points.values()], rings: reduceMotion ? [] : rings,
    pins: [{ lat: real.lat, lng: real.lon, el: realPin }, { lat: decoy.lat, lng: decoy.lon, el: decoyPin }],
    focus: newest ? { seq: newest.seq, geos: originsOf(newest).geos, to: destOf(newest) === 'decoy' ? decoy : real } : null
  };
}

/** 오른쪽 목록: 최근 출발지 + 국가별 출발지 */
function renderOrigins(s: DashboardState, events: RediEvent[]): void {
  // 같은 위치는 한 번만 센다 (재공격이 같은 프록시로 다시 와도 출발지는 그대로)
  const byCountry = new Map<string, { cities: Set<string>; spots: Set<string> }>();
  const spots = new Set<string>();
  let toDecoy = 0, virtual = false;
  for (const e of events) {
    const o = originsOf(e);
    virtual ||= o.virtual;
    if (destOf(e) === 'decoy') toDecoy += 1;
    for (const g of o.geos) {
      const k = g.country ?? '??';
      const c = byCountry.get(k) ?? { cities: new Set(), spots: new Set() };
      if (g.city) c.cities.add(g.city);
      c.spots.add(`${g.lat},${g.lon}`); spots.add(`${g.lat},${g.lon}`);
      byCountry.set(k, c);
    }
  }
  const rows = [...byCountry.entries()].sort((a, b) => b[1].spots.size - a[1].spots.size);
  const total = spots.size;
  $('gbMeta').textContent = total ? `출발지 ${total}곳 · ${rows.length}개국 · 미끼망 ${toDecoy}건` : '—';

  if (!total) {
    $('origins').innerHTML = '<p class="empty">출발지(src_geo 또는 src_ip)가 있는 이벤트가 아직 없습니다.</p>';
    return;
  }
  const max = rows[0][1].spots.size;
  const top = rows.slice(0, 8);
  const newest = events[events.length - 1];
  const ng = originsOf(newest).geos;
  const many = ng.length > 1 ? ` 외 ${ng.length - 1}곳` : '';
  const nd = destOf(newest);
  $('origins').innerHTML =
    `<div class="latest ${nd}"><span class="k">최근 출발지 → ${nd === 'decoy' ? '미끼망' : '실서비스'}</span>` +
      `<b>${esc(ng[0] ? place(ng[0]) : '—')}${esc(many)}</b>` +
      `<span class="mono">${esc([newest.actor_id, newest.src_ip ?? newest.request].filter(Boolean).join(' · '))}</span></div>` +
    '<ol class="countries">' + top.map(([code, c]) =>
      `<li><span class="cc mono">${esc(code)}</span>` +
        `<span class="cn">${esc(code === '??' ? '알 수 없음' : regionName(code))}<small>${esc([...c.cities].slice(0, 3).join(', '))}${c.cities.size > 3 ? ' …' : ''}</small></span>` +
        `<span class="bar"><i style="width:${Math.round(100 * c.spots.size / max)}%"></i></span>` +
        `<span class="n mono">${c.spots.size}</span></li>`).join('') +
    '</ol>' +
    (rows.length > top.length ? `<p class="more">외 ${rows.length - top.length}개국</p>` : '') +
    (s.source === 'mock' || virtual
      ? '<p class="note">표시된 위치는 실제 위치가 아닌 가상 위치입니다 (예시 IP 대역 · IP 해시).</p>'
      : '');
}

/** 새 이벤트 출발지와 도착지 사이로 카메라를 옮기고, 잠시 자동 회전을 멈춘다 */
function focusOn(gl: GlobeInstance, to: Geo, geos: Geo[]): void {
  const pts = geos.length > 5 ? [to] : [...geos, to];
  let x = 0, y = 0, z = 0;
  for (const p of pts) {
    const la = p.lat * Math.PI / 180, lo = p.lon * Math.PI / 180;
    x += Math.cos(la) * Math.cos(lo); y += Math.cos(la) * Math.sin(lo); z += Math.sin(la);
  }
  const lat = Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI;
  const lng = Math.atan2(y, x) * 180 / Math.PI;
  // 벡터 합이 짧을수록 점들이 멀리 퍼져 있음 → 더 멀리서 본다
  const spread = 1 - Math.hypot(x, y, z) / pts.length;
  pauseRotate(gl, 10_000);
  gl.pointOfView({ lat, lng, altitude: geos.length > 5 ? 2.2 : 1.7 + spread * 2.5 }, reduceMotion ? 0 : 1500);
}

function pauseRotate(gl: GlobeInstance, ms: number): void {
  if (reduceMotion) return;
  gl.controls().autoRotate = false;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { gl.controls().autoRotate = true; }, ms);
}

function apply(gl: GlobeInstance, sc: Scene): void {
  gl.arcsData(sc.arcs).pointsData(sc.points).ringsData(sc.rings).htmlElementsData(sc.pins);
  if (!sc.focus) { focusedSeq = 0; return; }
  if (sc.focus.seq !== focusedSeq) {
    if (sc.focus.seq > focusedSeq) focusOn(gl, sc.focus.to, sc.focus.geos);
    focusedSeq = sc.focus.seq;
  }
}

async function load(el: HTMLElement): Promise<void> {
  loading = true;
  try {
    const [{ default: Globe }, { feature }, atlas] = await Promise.all([
      import('globe.gl'), import('topojson-client'), import('world-atlas/countries-110m.json')
    ]);
    const topo = atlas.default as unknown as Parameters<typeof feature>[0];
    const land = feature(topo, topo.objects.countries) as unknown as { features: object[] };

    const gl = new Globe(el, { rendererConfig: { antialias: true, alpha: true, preserveDrawingBuffer: true } })
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true).atmosphereColor('#45C0CF').atmosphereAltitude(0.14)
      .hexPolygonsData(land.features).hexPolygonResolution(3).hexPolygonMargin(0.4)
      .hexPolygonUseDots(true).hexPolygonColor(() => 'rgba(142, 156, 151, .55)')
      .arcColor('color').arcStroke('stroke').arcDashLength('dash').arcDashGap('gap').arcAltitude('alt')
      .arcDashAnimateTime('animate').arcAltitudeAutoScale(0.3).arcLabel('label').arcsTransitionDuration(0)
      .pointColor('color').pointRadius('r').pointAltitude(0.012).pointLabel('label').pointsTransitionDuration(0)
      .ringColor((d: object) => (t: number) => fade((d as Ring).color, 1 - t))
      .ringMaxRadius('maxR').ringPropagationSpeed(2.5).ringRepeatPeriod(900)
      .htmlElement((d: object) => (d as Pin).el)
      .pointOfView({ lat: 30, lng: 90, altitude: 2.4 });

    const mat = gl.globeMaterial() as unknown as { color: { set(c: string): void } };
    mat.color.set('#0F1614');

    const controls = gl.controls();
    controls.enableZoom = false; // 휠은 페이지 스크롤에 양보
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => pauseRotate(gl, 8000));

    new ResizeObserver(() => gl.width(el.clientWidth).height(el.clientHeight)).observe(el);
    // 화면 밖이면 렌더링을 멈춘다
    new IntersectionObserver(([en]) => (en.isIntersecting ? gl.resumeAnimation() : gl.pauseAnimation())).observe(el);

    globe = gl;
    if (pending) apply(gl, pending);
  } catch (e) {
    console.warn('[redi] 지구본을 띄우지 못했습니다:', (e as Error).message);
    el.innerHTML = '<p class="empty">이 브라우저에서는 3D 지구본을 표시할 수 없습니다 (WebGL 필요).</p>';
  }
}

/** '#RRGGBB' 또는 'rgba(...)'에 투명도 곱하기 */
function fade(color: string, a: number): string {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return color.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * a})`);
}

export function renderGlobe(s: DashboardState): void {
  const actor = view.filter.startsWith('actor:') ? view.filter.slice(6) : null;
  const events = s.events.filter((e) => originsOf(e).geos.length && (!actor || e.actor_id === actor));
  const actors = (s.actors ?? []).filter((a) => !actor || a.id === actor);
  const last = s.events[s.events.length - 1];
  const rounds = s.rounds.map((r) => r.status);
  const actorKeys = actors.map((a) => [a.id, a.status, a.similarity]);
  if (!changed('globe', [events.map((e) => e.seq), last?.seq, last?.type, s.round, rounds, actorKeys,
    s.scenario.target_geo, s.scenario.decoy_geo])) return;

  renderOrigins(s, events);
  pending = buildScene(s, events, actors);
  if (globe) apply(globe, pending);
  else if (!loading) void load($('globe'));
}
