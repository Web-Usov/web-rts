import { describe, expect, it, vi } from "vitest";
import {
  RESUME_TOKEN_STORAGE_KEY,
  createSessionStorageResumeTokenStore,
} from "./resume-token-store.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("session resume token store", () => {
  it("writes and clears an opaque token in sessionStorage only", () => {
    const session = memoryStorage();
    const local = memoryStorage();
    vi.stubGlobal("localStorage", local);

    const store = createSessionStorageResumeTokenStore(session);
    store.write("room-1:opaque");
    expect(store.read()).toBe("room-1:opaque");
    expect(session.getItem(RESUME_TOKEN_STORAGE_KEY)).toBe("room-1:opaque");
    expect(local.length).toBe(0);

    store.clear();
    expect(store.read()).toBeNull();
    expect(session.getItem(RESUME_TOKEN_STORAGE_KEY)).toBeNull();
    vi.unstubAllGlobals();
  });
});
