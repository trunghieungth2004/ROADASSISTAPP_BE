class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}

class RouteBlockedError extends Error {
  statusCode: number;
  errors: unknown;
  constructor(zones: unknown) {
    super("Route is blocked by active road hazards");
    this.statusCode = 409;
    this.errors = zones;
  }
}

class WidthBlockedError extends Error {
  statusCode: number;
  errors: unknown;
  constructor(segments: unknown) {
    super("Route is impassable for this vehicle width");
    this.statusCode = 409;
    this.errors = segments;
  }
}

const isConflictError = (err: unknown): boolean =>
  (err as {statusCode?: unknown})?.statusCode === 409;

export {NotFoundError, RouteBlockedError, WidthBlockedError, isConflictError};
