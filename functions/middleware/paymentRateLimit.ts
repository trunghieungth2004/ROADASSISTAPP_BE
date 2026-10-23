import rateLimiter from "express-rate-limit";
import {Request} from "express";
import {AuthedRequest} from "./auth";

export const paymentAttemptKey = (req: Request): string => {
  const uid = (req as AuthedRequest).uid ?? "anonymous";
  const raw = req.body as Record<string, unknown> | undefined;
  const ticketId = typeof raw?.ticketId === "string" ? raw.ticketId : "none";
  return `payment:${uid}:${ticketId}`;
};

const configuredMax = Number(process.env.PAYMENT_WRITE_LIMIT_PER_MIN ?? 20);
const max = Number.isFinite(configuredMax) && configuredMax > 0 ?
  configuredMax :
  20;

const paymentWriteLimiter = rateLimiter({
  windowMs: 1 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: paymentAttemptKey,
  message: {
    statusCode: 429,
    status: "ERROR",
    message: "Too many payment attempts, please try again later",
  },
});

export default paymentWriteLimiter;
