/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL?: string;
  /** Published game-server host port used when VITE_GAME_SERVER_URL is empty. */
  readonly VITE_GAME_SERVER_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
