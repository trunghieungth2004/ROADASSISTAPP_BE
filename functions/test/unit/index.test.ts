import {Request} from "express";
import {ipKeyGenerator} from "express-rate-limit";
import {userOrIpKey} from "../../index";

const reqWith = (headers: Record<string, string>, ip: string): Request =>
  ({headers, ip} as unknown as Request);

describe("rate limit keys", () => {
  it("keys authenticated callers by token", () => {
    expect(
      userOrIpKey(reqWith({authorization: "Bearer abc"}, "1.2.3.4")),
    ).toBe("token:Bearer abc");
  });

  it("keys anonymous callers by normalized IP", () => {
    const ip = "2001:db8::1";
    expect(userOrIpKey(reqWith({}, ip))).toBe(`ip:${ipKeyGenerator(ip)}`);
  });
});
