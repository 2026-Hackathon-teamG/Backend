/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_POLL_MS?: string;
  readonly VITE_MOCK_STEP_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
