import {createHmac} from "crypto";
import {PAYMENT_CURRENCY} from "../constants/payments";
import {
  SEPAY_AUTHORIZATION_HEADER,
  SEPAY_AUTH_PREFIX,
  SEPAY_CANCEL_URL_VAR,
  SEPAY_CHECKOUT_METHOD,
  SEPAY_ENV,
  SEPAY_ERROR_URL_VAR,
  SEPAY_FIELD,
  SEPAY_MERCHANT_ID_VAR,
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

const merchantId = (): string => process.env[SEPAY_MERCHANT_ID_VAR] ?? "";

const secretKey = (): string => process.env[SEPAY_SECRET_KEY_VAR] ?? "";

const signFields = (
  fields: Record<string, string>,
  secret: string,
): string => {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
};

const buildCheckoutFields = (
  payment: SepayPaymentLike,
): SepayCheckoutFields => {
  const hosts = SEPAY_ENV[sepayEnv()];
  const orderRef = typeof payment.qrRef === "string" && payment.qrRef !== "" ?
    payment.qrRef :
    payment.id;
  const fields: Record<string, string> = {
    [SEPAY_FIELD.MERCHANT_ID]: merchantId(),
    [SEPAY_FIELD.ORDER_INVOICE_NUMBER]: orderRef,
    [SEPAY_FIELD.ORDER_AMOUNT]: String(payment.amount),
    [SEPAY_FIELD.CURRENCY]: payment.currency ?? PAYMENT_CURRENCY,
    [SEPAY_FIELD.ORDER_DESCRIPTION]:
      `${SEPAY_ORDER_DESCRIPTION_PREFIX} ${payment.ticketId}`,
    [SEPAY_FIELD.SUCCESS_URL]: process.env[SEPAY_SUCCESS_URL_VAR] ?? "",
    [SEPAY_FIELD.ERROR_URL]: process.env[SEPAY_ERROR_URL_VAR] ?? "",
    [SEPAY_FIELD.CANCEL_URL]: process.env[SEPAY_CANCEL_URL_VAR] ?? "",
  };
  fields[SEPAY_FIELD.SIGNATURE] = signFields(fields, secretKey());
  return {
    action: hosts.checkout,
    method: SEPAY_CHECKOUT_METHOD,
    fields,
    qrUrl:
      `${hosts.checkout}?order_invoice_number=${encodeURIComponent(orderRef)}`,
  };
};

const authorizationValue = (headers: Record<string, unknown>): string => {
  const raw = headers[SEPAY_AUTHORIZATION_HEADER];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
};

const verifyIpnAuth = (headers: Record<string, unknown>): boolean => {
  const secret = secretKey();
  if (secret === "") return false;
  return authorizationValue(headers) === `${SEPAY_AUTH_PREFIX} ${secret}`;
};

export {
  SepayPaymentLike,
  SepayCheckoutFields,
  buildCheckoutFields,
  verifyIpnAuth,
};
