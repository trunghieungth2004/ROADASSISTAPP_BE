import {NextFunction, Request, Response} from "express";
import {timingSafeEqual} from "crypto";

export const requireDeliverSecret = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const expected = process.env.PUSH_DELIVER_SECRET ?? "";
  if (expected === "") {
    next();
    return;
  }
  const got = req.header("X-Push-Secret") ?? "";
  if (
    got.length !== expected.length ||
    !timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  ) {
    res.status(403).json({
      statusCode: 403,
      status: "ERROR",
      message: "Forbidden",
    });
    return;
  }
  next();
};
