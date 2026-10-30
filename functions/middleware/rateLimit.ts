import {Request} from "express";
import rateLimiter, {ipKeyGenerator} from "express-rate-limit";

export const clientIpKey = (req: Request): string => {
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
};

export const writeLimited = rateLimiter({
  windowMs: 1 * 60 * 1000,
  max: Number(process.env.WRITE_LIMIT_PER_MIN ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIpKey,
  skip: (req: Request): boolean =>
    process.env.WRITE_LIMIT_DISABLED === "true" || req.method === "OPTIONS",
  validate: {forwardedHeader: false},
  message: {
    statusCode: 429,
    status: "ERROR",
    message: "Too many requests, please try again later",
  },
});
