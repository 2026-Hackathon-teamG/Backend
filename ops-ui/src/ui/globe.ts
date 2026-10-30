/**
 * 공격 출발지 지구본: 이벤트의 src_geo → 공격 대상 서버(scenario.target_geo)로 호를 그린다.
 * globe.gl(three.js)은 무거워서 처음 그릴 때 따로 불러온다. WebGL이 없으면 목록만 보인다.
 *   현재 라운드 진행 중  → 공격 빨강 / 정찰 보라, 흐르는 점선
 *   현재 라운드 차단 검증 → 초록 실선
 *   지난 라운드          → 회색
 * 공격 주체 카드로 타임라인을 거르면 지구본도 그 주체 것만 보인다.
 */
import type { GlobeInstance } from 'globe.gl';
import type { DashboardState, Geo, RediEvent } from '../types';
import { $, changed, esc, view } from './shared';

const DEFAULT_TARGET: Geo = { lat: 37.57, lon: 126.98, city: '서울', country: 'KR' };
const COLOR = { attack: '#F2665C', recon: '#A78BFA', blocked: '#4CC38A', old: 'rgba(142, 156, 151, .3)' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Arc {
  startLat: number; startLng: number; endLat: number; endLng: number;
  color: string; stroke: number; dash: number; gap: number; animate: number; label: string;
}
interface Point { lat: number; lng: number; color: string; r: number; label: string }
interface Ring { lat: number; lng: number; color: string; maxR: number }
interface Scene { arcs: Arc[]; points: Point[]; rings: Ring[]; target: Geo; focus: { seq: number; geos: Geo[] } | null }

let globe: GlobeInstance | null = null;
let loading = false;
let pending: Scene | null = null;
let focusedSeq = 0;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
const pin = document.createElement('div');

const regionName = (() => {
  try {
    const dn = new Intl.DisplayNames(['ko'], { type: 'region' });
    return (code: string) => dn.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

const place = (g: Geo): string => [g.city, g.country].filter(Boolean).join(' ');

function arcColor(e: RediEvent, s: DashboardState): string {
  if (e.round !== s.round) return COLOR.old;
  const status = s.rounds.find((r) => r.round === e.round)?.status;
  if (status === 'verified') return COLOR.blocked;
  return e.type === 'recon' ? COLOR.recon : COLOR.attack;
}

function buildScene(s: DashboardState, events: RediEvent[]): Scene {
  const target = s.scenario.target_geo ?? DEFAULT_TARGET;
  const arcs: Arc[] = [];
  const points = new Map<string, Point>();
  const recentSeq = new Set(s.events.slice(-3).map((e) => e.seq));
  const rings: Ring[] = [];

  for (const e of events) {
    const color = arcColor(e, s);
    const live = color === COLOR.attack || color === COLOR.recon;
    for (const g of e.src_geo ?? []) {
      const label = `<b>${esc(e.actor_id ?? '미식별')}</b> · ${esc(place(g))}<br>${esc(e.src_ip ?? '')}<br>라운드 ${esc(e.round)} · ${esc(e.time)}`;
      arcs.push({
        startLat: g.lat, startLng: g.lon, endLat: target.lat, endLng: target.lon, color, label,
        stroke: e.round === s.round ? 0.5 : 0.25,
        dash: live ? 0.35 : 1, gap: live ? 0.15 : 0, animate: live && !reduceMotion ? 1800 : 0
      });
      // 같은 위치는 점 하나로 (나중 이벤트 색이 이김)
      points.set(`${g.lat},${g.lon}`, { lat: g.lat, lng: g.lon, color, r: e.round === s.round ? 0.32 : 0.2, label });
      if (recentSeq.has(e.seq) && live) rings.push({ lat: g.lat, lng: g.lon, color, maxR: 3 });
    }
  }

  const last = s.events[s.events.length - 1];
  if (last?.type === 'breach') rings.push({ lat: target.lat, lng: target.lon, color: COLOR.attack, maxR: 6 });
  else if (last && ['rule_applied', 'verify', 'end'].includes(last.type)) rings.push({ lat: target.lat, lng: target.lon, color: COLOR.blocked, maxR: 6 });

  const newest = events[events.length - 1];
  return {
    arcs, points: [...points.values()], rings: reduceMotion ? [] : rings, target,
    focus: newest ? { seq: newest.seq, geos: newest.src_geo ?? [] } : null
  };
}

/** 오른쪽 목록: 국가별 출발지 */
function renderOrigins(s: DashboardState, events: RediEvent[]): void {
  const byCountry = new Map<string, { cities: Set<string>; actors: Set<string>; n: number }>();
  let total = 0;
  for (const e of events) {
    for (const g of e.src_geo ?? []) {
      const k = g.country ?? '??';
      const c = byCountry.get(k) ?? { cities: new Set(), actors: new Set(), n: 0 };
      if (g.city) c.cities.add(g.city);
      if (e.actor_id) c.actors.add(e.actor_id);
      c.n += 1; total += 1;
      byCountry.set(k, c);
    }
  }
  const rows = [...byCountry.entries()].sort((a, b) => b[1].n - a[1].n);
  $('gbMeta').textContent = total ? `출발지 ${total}곳 · ${rows.length}개국` : '—';

  if (!total) {
    $('origins').innerHTML = '<p class="empty">위치 정보(src_geo)가 있는 공격 이벤트가 아직 없습니다.</p>';
    return;
  }
  const max = rows[0][1].n;
  const top = rows.slice(0, 8);
  const newest = events[events.length - 1];
  const g0 = newest.src_geo?.[0];
  const many = (newest.src_geo?.length ?? 0) > 1 ? ` 외 ${newest.src_geo!.length - 1}곳` : '';
  $('origins').innerHTML =
    `<div class="latest"><span class="k">최근 출발지</span>` +
      `<b>${esc(g0 ? place(g0) : '—')}${esc(many)}</b>` +
      `<span class="mono">${esc(newest.actor_id ?? '')} · ${esc(newest.src_ip ?? '')}</span></div>` +
    '<ol class="countries">' + top.map(([code, c]) =>
      `<li><span class="cc mono">${esc(code)}</span>` +
        `<span class="cn">${esc(code === '??' ? '알 수 없음' : regionName(code))}<small>${esc([...c.cities].slice(0, 3).join(', '))}${c.cities.size > 3 ? ' …' : ''}</small></span>` +
        `<span class="bar"><i style="width:${Math.round(100 * c.n / max)}%"></i></span>` +
        `<span class="n mono">${c.n}</span></li>`).join('') +
    '</ol>' +
    (rows.length > top.length ? `<p class="more">외 ${rows.length - top.length}개국</p>` : '') +
    (s.source === 'mock' ? '<p class="note">목업 IP는 예시 대역이라 위치는 가상의 프록시 출구입니다.</p>' : '');
}

/** 새 이벤트 출발지와 대상 서버 사이로 카메라를 옮기고, 잠시 자동 회전을 멈춘다 */
function focusOn(gl: GlobeInstance, target: Geo, geos: Geo[]): void {
  const pts = geos.length > 5 ? [target] : [...geos, target];
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
  pin.querySelector('span')!.textContent = `공격 대상 · ${place(sc.target)}`;
  gl.arcsData(sc.arcs).pointsData(sc.points).ringsData(sc.rings)
    .htmlElementsData([{ lat: sc.target.lat, lng: sc.target.lon }]);
  if (!sc.focus) { focusedSeq = 0; return; }
  if (sc.focus.seq !== focusedSeq) {
    if (sc.focus.seq > focusedSeq) focusOn(gl, sc.target, sc.focus.geos);
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

    pin.className = 'globe-pin';
    pin.innerHTML = '<i></i><span></span>';

    const gl = new Globe(el, { rendererConfig: { antialias: true, alpha: true, preserveDrawingBuffer: true } })
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true).atmosphereColor('#45C0CF').atmosphereAltitude(0.14)
      .hexPolygonsData(land.features).hexPolygonResolution(3).hexPolygonMargin(0.4)
      .hexPolygonUseDots(true).hexPolygonColor(() => 'rgba(142, 156, 151, .55)')
      .arcColor('color').arcStroke('stroke').arcDashLength('dash').arcDashGap('gap')
      .arcDashAnimateTime('animate').arcAltitudeAutoScale(0.3).arcLabel('label').arcsTransitionDuration(0)
      .pointColor('color').pointRadius('r').pointAltitude(0.012).pointLabel('label').pointsTransitionDuration(0)
      .ringColor((d: object) => (t: number) => fade((d as Ring).color, 1 - t))
      .ringMaxRadius('maxR').ringPropagationSpeed(2.5).ringRepeatPeriod(900)
      .htmlElement(() => pin)
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
  const events = s.events.filter((e) => e.src_geo?.length && (!actor || e.actor_id === actor));
  const last = s.events[s.events.length - 1];
  const rounds = s.rounds.map((r) => r.status);
  if (!changed('globe', [events.map((e) => e.seq), last?.seq, last?.type, s.round, rounds, actor, s.scenario.target_geo])) return;

  renderOrigins(s, events);
  pending = buildScene(s, events);
  if (globe) apply(globe, pending);
  else if (!loading) void load($('globe'));
}
