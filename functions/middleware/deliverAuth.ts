import {NextFunction, Request, Response} from "express";
import {OAuth2Client} from "google-auth-library";
import {logError, logInfo} from "../utils/logger";

const deny = (res: Response): void => {
  res.status(403).json({
    statusCode: 403,
    status: "ERROR",
    message: "Forbidden",
  });
};

let oidcClient: OAuth2Client | null = null;

export const __resetOidcClientForTests = (): void => {
  oidcClient = null;
};

const deliverAudiences = (): string[] =>
  [process.env.PUSH_DELIVER_URL, process.env.DISPATCH_DELIVER_URL].filter(
    (u): u is string => typeof u === "string" && u !== "",
  );

export const requireDeliverIdentity = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedEmail = process.env.TASK_INVOKER_EMAIL ?? "";
  const audiences = deliverAudiences();
  if (token === "" || expectedEmail === "" || audiences.length === 0) {
    deny(res);
    return;
  }
  try {
    oidcClient ??= new OAuth2Client();
    const idToken = await oidcClient.verifyIdToken({
      idToken: token,
      audience: audiences,
    });
    const email = idToken.getPayload()?.email ?? "";
    if (email !== expectedEmail) {
      logError("push", "deliver identity email mismatch", {email});
      deny(res);
      return;
    }
    logInfo("push", "deliver identity verified", {email});
    next();
  } catch (err) {
    logError("push", "deliver identity rejected", {}, err);
    deny(res);
  }
};
