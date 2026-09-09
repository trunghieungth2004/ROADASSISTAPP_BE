import {createCache, parseTtl, sizeOf} from "../../../utils/cache";

describe("createCache", () => {
  it("returns undefined for a missing key", () => {
    const cache = createCache({ttlMs: 1000});
    expect(cache.get("nope")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    const cache = createCache({ttlMs: 1000});
    cache.set("k", {a: 1});
    expect(cache.get("k")).toEqual({a: 1});
    expect(cache.has("k")).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it("expires entries after ttlMs", async () => {
    const cache = createCache({ttlMs: 20});
    cache.set("k", 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cache.get("k")).toBeUndefined();
  });

  it("deletes a single key", () => {
    const cache = createCache({ttlMs: 1000});
    cache.set("k", 1);
    cache.del("k");
    expect(cache.get("k")).toBeUndefined();
  });

  it("clears all keys", () => {
    const cache = createCache({ttlMs: 1000});
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe("sizeOf", () => {
  it("measures strings in bytes", () => {
    expect(sizeOf("abc")).toBe(3);
  });

  it("measures numbers and booleans as 8", () => {
    expect(sizeOf(42)).toBe(8);
    expect(sizeOf(true)).toBe(8);
  });

  it("returns the minimum size for nullish values", () => {
    expect(sizeOf(null)).toBe(1);
    expect(sizeOf(undefined)).toBe(1);
  });

  it("sums arrays and stringifies objects", () => {
    expect(sizeOf(["ab", "c"])).toBe(3);
    expect(sizeOf({a: 1})).toBe(Buffer.byteLength(JSON.stringify({a: 1})));
  });
});

describe("parseTtl", () => {
  it("falls back when unset or invalid", () => {
    expect(parseTtl(undefined, 1000)).toBe(1000);
    expect(parseTtl("abc", 1000)).toBe(1000);
    expect(parseTtl("0", 1000)).toBe(1000);
    expect(parseTtl("-5", 1000)).toBe(1000);
  });

  it("parses positive integers", () => {
    expect(parseTtl("5000", 1000)).toBe(5000);
  });
});
