import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// 머리글과 인감을 빌드 시점에 HTML로 넣음. 공격 에이전트는 JS를 실행하지 않고 HTML만 읽음
function partials(): Plugin {
  return {
    name: 'html-partials',
    transformIndexHtml: (html) =>
      html.replace(/<!--\s*@(\w+)\s*-->/g, (_, name: string) =>
        readFileSync(resolve('partials', `${name}.html`), 'utf-8')),
  };
}

export default defineConfig({
  plugins: [partials()],
  server: { port: 8005, host: true },
  preview: { port: 8005, host: true },
  build: {
    rollupOptions: {
      input: ['index.html', 'login.html', 'account.html', 'support.html'],
    },
  },
});
