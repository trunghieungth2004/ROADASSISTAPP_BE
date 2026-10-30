import {createHmac} from "crypto";
import {
  SIGNED_FIELDS,
  buildCheckoutFields,
  checkoutToken,
  verifyCheckoutToken,
  verifyIpnAuth,
} from "../../../service/sepayService";

const ENV = {
  SEPAY_MERCHANT_ID: "SP-TEST-123",
  SEPAY_SECRET_KEY: "test-secret",
  SEPAY_ENV: "sandbox",
  PAYMENT_BRIDGE_URL: "https://api.example.com",
  SEPAY_SUCCESS_URL: "https://example.com/success",
  SEPAY_ERROR_URL: "https://example.com/error",
  SEPAY_CANCEL_URL: "https://example.com/cancel",
};

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
});

describe("sepayService checkout", () => {
  const payment = {
    id: "pay1",
    ticketId: "ticket1",
    amount: 100000,
    qrRef: "QR-1",
  };

  it("builds the documented field order and base64 signature", () => {
    const checkout = buildCheckoutFields(payment);
    expect(checkout.action).toBe(
      "https://pay-sandbox.sepay.vn/v1/checkout/init",
    );
    expect(checkout.fields).toMatchObject({
      merchant: "SP-TEST-123",
      currency: "VND",
      order_amount: "100000",
      operation: "PURCHASE",
      order_invoice_number: "QR-1",
    });
    const signed = SIGNED_FIELDS
      .filter((key) =>
        typeof checkout.fields[key] === "string" &&
        checkout.fields[key] !== "")
      .map((key) => `${key}=${checkout.fields[key]}`)
      .join(",");
    const expected = createHmac("sha256", "test-secret")
      .update(signed)
      .digest("base64");
    expect(checkout.fields.signature).toBe(expected);
    const url = new URL(checkout.qrUrl);
    expect(url.origin + url.pathname).toBe(
      "https://api.example.com/payments/sepay/checkout/pay1",
    );
    expect(verifyCheckoutToken("pay1", url.searchParams.get("token") ?? ""))
      .toBe(true);
  });

  it("uses the production checkout host when configured", () => {
    process.env.SEPAY_ENV = "production";
    const checkout = buildCheckoutFields(payment);
    expect(checkout.action).toBe("https://pay.sepay.vn/v1/checkout/init");
  });
});

describe("sepayService auth and tokens", () => {
  it("accepts the current X-Secret-Key IPN auth and the legacy header", () => {
    expect(verifyIpnAuth({"x-secret-key": "test-secret"})).toBe(true);
    expect(verifyIpnAuth({authorization: "Apikey test-secret"})).toBe(true);
    expect(verifyIpnAuth({"x-secret-key": "wrong"})).toBe(false);
  });

  it("round-trips a checkout token and rejects tampering", () => {
    const token = checkoutToken("pay1");
    expect(verifyCheckoutToken("pay1", token)).toBe(true);
    expect(verifyCheckoutToken("pay2", token)).toBe(false);
    expect(verifyCheckoutToken("pay1", token.slice(0, -1))).toBe(false);
  });
});
