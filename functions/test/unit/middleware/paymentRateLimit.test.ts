import {Request} from "express";
import {paymentAttemptKey} from "../../../middleware/paymentRateLimit";

const req = (uid?: string, ticketId?: unknown): Request =>
  ({uid, body: {ticketId}} as unknown as Request);

describe("paymentAttemptKey", () => {
  it("scopes attempts to the caller and ticket", () => {
    expect(paymentAttemptKey(req("u1", "t1"))).toBe("payment:u1:t1");
    expect(paymentAttemptKey(req("u1", "t2"))).toBe("payment:u1:t2");
    expect(paymentAttemptKey(req("u2", "t1"))).toBe("payment:u2:t1");
  });

  it("falls back safely for missing fields", () => {
    expect(paymentAttemptKey(req(undefined, undefined)))
      .toBe("payment:anonymous:none");
    expect(paymentAttemptKey(req("u1", 42))).toBe("payment:u1:none");
  });
});
