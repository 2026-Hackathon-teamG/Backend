import { defineConfig } from 'vite';

// 백엔드 compose와 같은 포트(:8003)로 띄움
export default defineConfig({
  server: { port: 8003, host: true },
  preview: { port: 8003, host: true },
});
