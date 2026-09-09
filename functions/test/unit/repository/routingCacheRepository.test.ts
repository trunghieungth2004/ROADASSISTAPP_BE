import {
  isExpired,
  ttlSeconds,
  DEFAULT_TTL_SECONDS,
} from "../../../repository/routingCacheRepository";

describe("routingCacheRepository.isExpired", () => {
  const now = Date.parse("2026-09-09T00:00:00.000Z");

  it("treats entries without expiresAt as valid (legacy docs)", () => {
    expect(isExpired(undefined, now)).toBe(false);
  });

  it("treats future expiresAt as valid", () => {
    expect(isExpired("2026-10-09T00:00:00.000Z", now)).toBe(false);
  });

  it("treats past expiresAt as expired", () => {
    expect(isExpired("2026-08-09T00:00:00.000Z", now)).toBe(true);
  });

  it("treats expiresAt equal to now as expired", () => {
    expect(isExpired("2026-09-09T00:00:00.000Z", now)).toBe(true);
  });

  it("treats unparseable expiresAt as expired (self-healing)", () => {
    expect(isExpired("not-a-date", now)).toBe(true);
  });
});

describe("routingCacheRepository.ttlSeconds", () => {
  const OLD = process.env.ROUTING_CACHE_TTL_SECONDS;

  afterEach(() => {
    if (OLD === undefined) {
      delete process.env.ROUTING_CACHE_TTL_SECONDS;
    } else {
      process.env.ROUTING_CACHE_TTL_SECONDS = OLD;
    }
  });

  it("defaults to 30 days when unset", () => {
    delete process.env.ROUTING_CACHE_TTL_SECONDS;
    expect(ttlSeconds()).toBe(DEFAULT_TTL_SECONDS);
    expect(DEFAULT_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("honors a positive override", () => {
    process.env.ROUTING_CACHE_TTL_SECONDS = "3600";
    expect(ttlSeconds()).toBe(3600);
  });

  it("falls back on zero, negative, or non-numeric values", () => {
    for (const bad of ["0", "-5", "soon", ""]) {
      process.env.ROUTING_CACHE_TTL_SECONDS = bad;
      expect(ttlSeconds()).toBe(DEFAULT_TTL_SECONDS);
    }
  });
});
