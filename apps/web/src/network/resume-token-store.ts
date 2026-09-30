/**
 * Opaque session resume token.
 * sessionStorage survives a tab reload and is not shared across tabs.
 * localStorage would let two players in one browser overwrite each other.
 */
export const RESUME_TOKEN_STORAGE_KEY = "web-rts.reconnectionToken";

export type OpaqueResumeTokenStore = {
  read(): string | null;
  write(token: string): void;
  clear(): void;
};

export function createSessionStorageResumeTokenStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = globalSessionStorage(),
): OpaqueResumeTokenStore {
  return {
    read() {
      if (!storage) {
        return null;
      }
      return storage.getItem(RESUME_TOKEN_STORAGE_KEY);
    },
    write(token: string) {
      storage?.setItem(RESUME_TOKEN_STORAGE_KEY, token);
    },
    clear() {
      storage?.removeItem(RESUME_TOKEN_STORAGE_KEY);
    },
  };
}

function globalSessionStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  if (typeof sessionStorage === "undefined") {
    return undefined;
  }
  return sessionStorage;
}
