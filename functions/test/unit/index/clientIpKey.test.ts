import {Request} from "express";
import {ipKeyGenerator} from "express-rate-limit";
import {clientIpKey, userOrIpKey} from "../../../index";

const reqWith = (
  headers: Record<string, string>,
  ip?: string,
): Request => ({headers, ip} as unknown as Request);

describe("clientIpKey", () => {
  it("keys requests with different tokens by IP", () => {
    const first = clientIpKey(
      reqWith({authorization: "Bearer token-a"}, "1.2.3.4"),
    );
    const second = clientIpKey(
      reqWith({authorization: "Bearer token-b"}, "1.2.3.4"),
    );
    expect(second).toBe(first);
  });

  it("produces different keys for different IPs", () => {
    const first = clientIpKey(reqWith({}, "1.2.3.4"));
    const second = clientIpKey(reqWith({}, "5.6.7.8"));
    expect(second).not.toBe(first);
  });

  it("produces a defined string key without an IP", () => {
    const key = clientIpKey(reqWith({}));
    expect(typeof key).toBe("string");
    expect(key).toBe(`ip:${ipKeyGenerator("")}`);
  });
});

describe("userOrIpKey", () => {
  it("keys the same token identically across IPs", () => {
    const first = userOrIpKey(
      reqWith({authorization: "Bearer token-a"}, "1.2.3.4"),
    );
    const second = userOrIpKey(
      reqWith({authorization: "Bearer token-a"}, "5.6.7.8"),
    );
    expect(second).toBe(first);
  });

  it("separates different tokens on the same IP", () => {
    const first = userOrIpKey(
      reqWith({authorization: "Bearer token-a"}, "1.2.3.4"),
    );
    const second = userOrIpKey(
      reqWith({authorization: "Bearer token-b"}, "1.2.3.4"),
    );
    expect(second).not.toBe(first);
  });

  it("falls back to the IP without a bearer token", () => {
    const key = userOrIpKey(reqWith({}, "1.2.3.4"));
    expect(key).toBe(clientIpKey(reqWith({}, "1.2.3.4")));
  });

  it("falls back to the IP for another auth scheme", () => {
    const key = userOrIpKey(
      reqWith({authorization: "Basic abc"}, "1.2.3.4"),
    );
    expect(key).toBe(clientIpKey(reqWith({}, "1.2.3.4")));
  });
});
