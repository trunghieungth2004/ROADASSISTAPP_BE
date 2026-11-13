import {createHash} from "crypto";
import {Request} from "express";
import rateLimiter, {ipKeyGenerator} from "express-rate-limit";

export const clientIpKey = (req: Request): string => {
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
};

const bearerOf = (req: Request): string => {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return "";
  }
  return header.slice(7).trim();
};

export const userOrIpKey = (req: Request): string => {
  const token = bearerOf(req);
  if (token === "") return clientIpKey(req);
  const digest = createHash("sha256").update(token).digest("base64url");
  return `user:${digest.slice(0, 32)}`;
};

export const writeLimited = rateLimiter({
  windowMs: 1 * 60 * 1000,
  max: Number(process.env.WRITE_LIMIT_PER_MIN ?? 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: (req: Request): boolean =>
    process.env.WRITE_LIMIT_DISABLED === "true" || req.method === "OPTIONS",
  validate: {forwardedHeader: false},
  message: {
    statusCode: 429,
    status: "ERROR",
    message: "Too many requests, please try again later",
  },
});
