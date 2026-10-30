import { defineConfig, loadEnv } from 'vite';

/**
 * 개발 서버(npm run dev)와 미리보기(npm run preview)는 /api 요청을 백엔드로 넘긴다.
 * 그래서 프론트에서는 CORS 신경 없이 같은 주소의 /api/state 를 부르면 된다.
 *   백엔드 주소 바꾸기: .env.local 에 API_PROXY_TARGET=http://192.168.0.10:8000
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.API_PROXY_TARGET || 'http://localhost:8000';
  const proxy = { '/api': { target, changeOrigin: true } };

  return {
    base: './', // dist를 어느 경로(FastAPI StaticFiles 등)에 올려도 동작
    server: { host: true, port: 5173, proxy },   // host: true → 같은 Wi-Fi의 다른 PC에서도 접속 가능
    preview: { host: true, port: 4173, proxy },
    build: { outDir: 'dist', sourcemap: true }
  };
});
