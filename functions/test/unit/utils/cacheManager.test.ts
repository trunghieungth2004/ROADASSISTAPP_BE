import * as cacheManager from "../../../utils/cacheManager";

describe("cacheManager with CACHE_ENABLED=false", () => {
  it("reports disabled", () => {
    expect(cacheManager.isCacheEnabled()).toBe(false);
  });

  it("get returns undefined and set is a no-op", () => {
    cacheManager.set("probe", "k", {a: 1});
    expect(cacheManager.get("probe", "k")).toBeUndefined();
  });

  it("wrap passes through to fn on every call", async () => {
    const fn = jest.fn(async (x: number) => x * 2);
    const wrapped = cacheManager.wrap(fn, {namespace: "probeWrap"});
    await expect(wrapped(2)).resolves.toBe(4);
    await expect(wrapped(2)).resolves.toBe(4);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("del does not throw for unknown namespaces", () => {
    expect(() => cacheManager.del("nope", "k")).not.toThrow();
    expect(() => cacheManager.del("nope")).not.toThrow();
  });
});

describe("cacheManager with CACHE_ENABLED=true", () => {
  const OLD = process.env.CACHE_ENABLED;

  beforeEach(() => {
    process.env.CACHE_ENABLED = "true";
  });

  afterEach(() => {
    process.env.CACHE_ENABLED = OLD;
    cacheManager.del("probeOn");
  });

  it("caches wrapped results and serves hits", async () => {
    const fn = jest.fn(async (x: number) => x + 1);
    const wrapped = cacheManager.wrap(fn, {namespace: "probeOn"});
    await expect(wrapped(1)).resolves.toBe(2);
    await expect(wrapped(1)).resolves.toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("invalidate and invalidateAll clear entries", async () => {
    const fn = jest.fn(async (x: number) => x);
    const wrapped = cacheManager.wrap(fn, {
      namespace: "probeOn",
      keyFn: (x: number) => `k${x}`,
    }) as unknown as {
      (x: number): Promise<unknown>;
      invalidate: (k: string) => void;
      invalidateAll: () => void;
    };
    await wrapped(1);
    expect(fn).toHaveBeenCalledTimes(1);
    wrapped.invalidate("k1");
    await wrapped(1);
    expect(fn).toHaveBeenCalledTimes(2);
    wrapped.invalidateAll();
    await wrapped(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("shares one execution across concurrent misses", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fn = jest.fn(async (x: number) => {
      await gate;
      return x * 3;
    });
    const wrapped = cacheManager.wrap(fn, {namespace: "probeDedup"});
    const pending = Promise.all([wrapped(2), wrapped(2)]);
    release();
    await expect(pending).resolves.toEqual([6, 6]);
    expect(fn).toHaveBeenCalledTimes(1);
    cacheManager.del("probeDedup");
  });
});
