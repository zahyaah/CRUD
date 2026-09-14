/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the API, for deployments where the UI and API are on different hosts.
   * Left unset in development, where Vite proxies the API under its own origin.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
