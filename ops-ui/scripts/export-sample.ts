/**
 * 목업 시나리오에서 백엔드용 예시 응답을 만든다.
 *   npm run sample
 * → stub/sample-state.json            (시나리오 종료 시점)
 *   stub/sample-state-round4-decoy.json (라운드 4 미끼 접촉 직후)
 *   stub/states.json                   (단계별 전체, 스텁 서버가 순서대로 재생)
 */
import { writeFileSync } from 'node:fs';
import { buildState, TOTAL_STEPS } from '../src/mock/buildState';
import { EVENTS } from '../src/mock/scenario';

const out = (name: string, data: unknown, pretty = true) =>
  writeFileSync(new URL(`../stub/${name}`, import.meta.url), JSON.stringify(data, null, pretty ? 2 : 0) + '\n', 'utf8');

const decoyStep = EVENTS.findIndex((e) => e.round === 4 && e.type === 'decoy_hit') + 1;

out('sample-state.json', buildState(TOTAL_STEPS));
out('sample-state-round4-decoy.json', buildState(decoyStep));
out('states.json', Array.from({ length: TOTAL_STEPS + 1 }, (_, s) => buildState(s)), false);
console.log(`stub/ 예시 응답 생성 완료 (이벤트 ${TOTAL_STEPS}개, 미끼 접촉 단계 ${decoyStep})`);
