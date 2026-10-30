import {createHmac, timingSafeEqual} from "crypto";
import {PAYMENT_CURRENCY} from "../constants/payments";
import {
  SEPAY_AUTHORIZATION_HEADER,
  SEPAY_AUTH_PREFIX,
  SEPAY_BRIDGE_URL_VAR,
  SEPAY_CANCEL_URL_VAR,
  SEPAY_CHECKOUT_METHOD,
  SEPAY_ENV,
  SEPAY_ERROR_URL_VAR,
  SEPAY_FIELD,
  SEPAY_IPN_AUTH_HEADER,
  SEPAY_MERCHANT_ID_VAR,
  SEPAY_OPERATION_PURCHASE,
  SEPAY_ORDER_DESCRIPTION_PREFIX,
  SEPAY_SECRET_KEY_VAR,
  SEPAY_SUCCESS_URL_VAR,
  sepayEnv,
} from "../constants/sepay";

interface SepayPaymentLike {
  id: string;
  ticketId: string;
  amount: number;
  currency?: string;
  qrRef?: string | null;
}

interface SepayCheckoutFields {
  action: string;
  method: string;
  fields: Record<string, string>;
  qrUrl: string;
}

const CHECKOUT_TOKEN_TTL_MS = 15 * 60 * 1000;

const SIGNED_FIELDS = [
  SEPAY_FIELD.ORDER_AMOUNT,
  SEPAY_FIELD.MERCHANT,
  SEPAY_FIELD.CURRENCY,
  SEPAY_FIELD.OPERATION,
  SEPAY_FIELD.ORDER_DESCRIPTION,
  SEPAY_FIELD.ORDER_INVOICE_NUMBER,
  SEPAY_FIELD.CUSTOMER_ID,
  SEPAY_FIELD.PAYMENT_METHOD,
  SEPAY_FIELD.SUCCESS_URL,
  SEPAY_FIELD.ERROR_URL,
  SEPAY_FIELD.CANCEL_URL,
];

const merchantId = (): string => process.env[SEPAY_MERCHANT_ID_VAR] ?? "";

const secretKey = (): string => process.env[SEPAY_SECRET_KEY_VAR] ?? "";

const signFields = (fields: Record<string, string>): string => {
  const signed = SIGNED_FIELDS
    .filter((key) => typeof fields[key] === "string" && fields[key] !== "")
    .map((key) => `${key}=${fields[key]}`)
    .join(",");
  return createHmac("sha256", secretKey())
    .update(signed)
    .digest("base64");
};

const bridgeBase = (): string =>
  (process.env[SEPAY_BRIDGE_URL_VAR] ?? "https://api-pgjgmzblba-as.a.run.app")
    .replace(/\/+$/, "");

const checkoutToken = (paymentId: string): string => {
  const expiresAt = Date.now() + CHECKOUT_TOKEN_TTL_MS;
  const payload = `${paymentId}.${expiresAt}`;
  const signature = createHmac("sha256", secretKey())
    .update(payload)
    .digest("base64url");
  return `${expiresAt}.${signature}`;
};

const verifyCheckoutToken = (paymentId: string, token: string): boolean => {
  const dot = token.indexOf(".");
  if (dot <= 0 || secretKey() === "") return false;
  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = createHmac("sha256", secretKey())
    .update(`${paymentId}.${expiresAt}`)
    .digest("base64url");
  const actual = token.slice(dot + 1);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

const buildCheckoutFields = (
  payment: SepayPaymentLike,
): SepayCheckoutFields => {
  const hosts = SEPAY_ENV[sepayEnv()];
  const orderRef = typeof payment.qrRef === "string" && payment.qrRef !== "" ?
    payment.qrRef :
    payment.id;
  const fields: Record<string, string> = {
    [SEPAY_FIELD.MERCHANT]: merchantId(),
    [SEPAY_FIELD.CURRENCY]: payment.currency ?? PAYMENT_CURRENCY,
    [SEPAY_FIELD.ORDER_AMOUNT]: String(payment.amount),
    [SEPAY_FIELD.OPERATION]: SEPAY_OPERATION_PURCHASE,
    [SEPAY_FIELD.ORDER_DESCRIPTION]:
      `${SEPAY_ORDER_DESCRIPTION_PREFIX} ${payment.ticketId}`,
    [SEPAY_FIELD.ORDER_INVOICE_NUMBER]: orderRef,
    [SEPAY_FIELD.SUCCESS_URL]: process.env[SEPAY_SUCCESS_URL_VAR] ?? "",
    [SEPAY_FIELD.ERROR_URL]: process.env[SEPAY_ERROR_URL_VAR] ?? "",
    [SEPAY_FIELD.CANCEL_URL]: process.env[SEPAY_CANCEL_URL_VAR] ?? "",
  };
  fields[SEPAY_FIELD.SIGNATURE] = signFields(fields);
  return {
    action: hosts.checkout,
    method: SEPAY_CHECKOUT_METHOD,
    fields,
    qrUrl: `${bridgeBase()}/payments/sepay/checkout/` +
      `${encodeURIComponent(payment.id)}?token=` +
      encodeURIComponent(checkoutToken(payment.id)),
  };
};

const authorizationValue = (headers: Record<string, unknown>): string => {
  const raw = headers[SEPAY_AUTHORIZATION_HEADER];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
};

const ipnSecretValue = (headers: Record<string, unknown>): string => {
  const raw = headers[SEPAY_IPN_AUTH_HEADER];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
};

const verifyIpnAuth = (headers: Record<string, unknown>): boolean => {
  const secret = secretKey();
  if (secret === "") return false;
  const headerSecret = ipnSecretValue(headers);
  if (headerSecret !== "") return headerSecret === secret;
  return authorizationValue(headers) === `${SEPAY_AUTH_PREFIX} ${secret}`;
};

export {
  SepayPaymentLike,
  SepayCheckoutFields,
  SIGNED_FIELDS,
  buildCheckoutFields,
  checkoutToken,
  verifyCheckoutToken,
  verifyIpnAuth,
};
