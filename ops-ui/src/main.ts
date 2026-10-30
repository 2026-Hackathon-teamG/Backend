import './styles.css';
import { createSource } from './api';
import { loadConfig } from './config';
import { bind, render, setConn } from './ui';

async function start(): Promise<void> {
  const cfg = loadConfig();
  setConn('wait', '연결 확인 중');

  const source = await createSource(cfg);
  bind(source);
  if (source.kind === 'mock') setConn('mock', 'MOCK · 샘플 데이터');

  // 폴링: 성공하면 원래 간격, 실패하면 최대 10초까지 늘려 재시도
  let failures = 0;
  const tick = async (): Promise<void> => {
    try {
      const state = await source.getState();
      failures = 0;
      if (source.kind === 'live') setConn('live', `LIVE · ${source.label}`);
      render(state);
    } catch (e) {
      failures += 1;
      setConn('err', `연결 끊김 · 재시도 ${failures}회 (${(e as Error).message})`);
    }
    const delay = failures ? Math.min(10_000, source.pollMs * 2 ** failures) : source.pollMs;
    setTimeout(tick, delay);
  };
  void tick();
}

void start();
