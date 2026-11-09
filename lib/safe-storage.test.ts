import { afterEach, describe, expect, it } from "vitest";
import { isStorageAvailable, readStorage, removeStorage, writeStorage } from "./safe-storage";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function setWindow(value: unknown) {
  Object.defineProperty(globalThis, "window", { value, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("safe storage", () => {
  it("round-trips values on a working storage", () => {
    setWindow({ localStorage: fakeStorage(), sessionStorage: fakeStorage() });
    writeStorage("local", "k", "v");
    expect(readStorage("local", "k")).toBe("v");
    expect(readStorage("session", "k")).toBeNull();
    removeStorage("local", "k");
    expect(readStorage("local", "k")).toBeNull();
    expect(isStorageAvailable("local")).toBe(true);
  });

  it("returns null and no-ops when window is undefined", () => {
    Reflect.deleteProperty(globalThis, "window");
    expect(readStorage("local", "k")).toBeNull();
    expect(() => writeStorage("local", "k", "v")).not.toThrow();
    expect(() => removeStorage("local", "k")).not.toThrow();
    expect(isStorageAvailable("local")).toBe(false);
  });

  it("returns null and no-ops when the storage object is undefined", () => {
    setWindow({ localStorage: undefined, sessionStorage: undefined });
    expect(readStorage("local", "k")).toBeNull();
    expect(readStorage("session", "k")).toBeNull();
    expect(() => writeStorage("local", "k", "v")).not.toThrow();
    expect(() => removeStorage("session", "k")).not.toThrow();
    expect(isStorageAvailable("session")).toBe(false);
  });

  it("returns null and no-ops when the storage getter throws", () => {
    const blocked = {};
    for (const name of ["localStorage", "sessionStorage"]) {
      Object.defineProperty(blocked, name, {
        get() { throw new DOMException("blocked", "SecurityError"); },
      });
    }
    setWindow(blocked);
    expect(readStorage("local", "k")).toBeNull();
    expect(readStorage("session", "k")).toBeNull();
    expect(() => writeStorage("local", "k", "v")).not.toThrow();
    expect(() => removeStorage("session", "k")).not.toThrow();
    expect(isStorageAvailable("local")).toBe(false);
  });

  it("swallows errors thrown by getItem, setItem and removeItem", () => {
    const boom = () => { throw new DOMException("full", "QuotaExceededError"); };
    setWindow({ localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(readStorage("local", "k")).toBeNull();
    expect(() => writeStorage("local", "k", "v")).not.toThrow();
    expect(() => removeStorage("local", "k")).not.toThrow();
  });
});
