// In-memory AsyncStorage.
//
// The catch-all empty stub exported `{}`, so every getItem threw, storage.ts
// caught it and returned null, and any test touching persistence silently
// exercised an always-empty store. The vault tests need real read-back to prove
// a concurrent hold survives a flush, so this is a working implementation
// rather than a shape.
const mem = new Map<string, string>();

export function __reset(): void {
  mem.clear();
}

const AsyncStorage = {
  async getItem(k: string): Promise<string | null> {
    return mem.has(k) ? (mem.get(k) as string) : null;
  },
  async setItem(k: string, v: string): Promise<void> {
    mem.set(k, v);
  },
  async removeItem(k: string): Promise<void> {
    mem.delete(k);
  },
  async clear(): Promise<void> {
    mem.clear();
  },
};

export default AsyncStorage;
