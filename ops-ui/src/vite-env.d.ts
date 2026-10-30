/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** detector 주소를 빌드 시 고정할 때 (예: http://10.0.0.5:8002) */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
