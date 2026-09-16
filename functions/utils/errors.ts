class AppError extends Error {
  statusCode: number;
  errors?: unknown;
  constructor(message: string, statusCode: number, errors?: unknown) {
    super(message);
    this.statusCode = statusCode;
    if (errors !== undefined) this.errors = errors;
  }
}

class ValidationError extends AppError {
  constructor(message: string, statusCode = 400) {
    super(message, statusCode);
  }
}

class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

class ForbiddenError extends AppError {
  constructor(message: string) {
    super(message, 403);
  }
}

class ConflictError extends AppError {
  constructor(message: string, errors?: unknown) {
    super(message, 409, errors);
  }
}

export {AppError, ValidationError, NotFoundError, ForbiddenError,
  ConflictError};
