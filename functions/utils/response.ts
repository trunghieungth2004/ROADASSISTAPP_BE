import {Response} from "express";

interface AppError extends Error {
  statusCode?: number;
  errors?: unknown;
}

export const sendSuccess = (
  res: Response,
  data?: unknown,
  {message, statusCode = 200}: { message?: string; statusCode?: number } = {},
): Response => {
  const body: Record<string, unknown> = {statusCode, status: "SUCCESS"};
  if (message !== undefined) body.message = message;
  if (data !== undefined) body.data = data;
  return res.status(statusCode).json(body);
};

export const sendError = (res: Response, error?: AppError | null): Response => {
  const statusCode = error && error.statusCode ? error.statusCode : 500;
  const body: Record<string, unknown> = {
    statusCode,
    status: "ERROR",
    message: error && error.message ? error.message : "Internal server error",
  };
  if (error && error.errors) body.errors = error.errors;
  return res.status(statusCode).json(body);
};

export const handleServiceError = sendError;
