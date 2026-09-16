import {NextFunction, Request, Response} from "express";
import {AsyncLocalStorage} from "async_hooks";
import {randomUUID} from "crypto";

const REQUEST_ID_HEADER = "x-request-id";

const store = new AsyncLocalStorage<{requestId: string}>();

const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const requestId =
    (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
  res.setHeader("X-Request-Id", requestId);
  store.run({requestId}, () => next());
};

const currentRequestId = (): string | undefined =>
  store.getStore()?.requestId;

const errorFields = (err: unknown): Record<string, unknown> => {
  if (err instanceof Error) {
    return {error: {name: err.name, message: err.message, stack: err.stack}};
  }
  return {error: String(err)};
};

const emit = (
  level: "info" | "warn" | "error",
  scope: string,
  msg: string,
  fields: Record<string, unknown> = {},
  err?: unknown,
): void => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    requestId: currentRequestId() ?? null,
    ...fields,
    ...(err === undefined ? {} : errorFields(err)),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

const logInfo = (
  scope: string,
  msg: string,
  fields: Record<string, unknown> = {},
): void => emit("info", scope, msg, fields);

const logWarn = (
  scope: string,
  msg: string,
  fields: Record<string, unknown> = {},
): void => emit("warn", scope, msg, fields);

const logError = (
  scope: string,
  msg: string,
  fields: Record<string, unknown> = {},
  err?: unknown,
): void => emit("error", scope, msg, fields, err);

export {
  requestIdMiddleware,
  currentRequestId,
  logInfo,
  logWarn,
  logError,
};
