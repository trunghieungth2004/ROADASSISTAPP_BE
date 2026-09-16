import {NotFoundError} from "../../utils/errors";

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

class EndpointBlockedError extends Error {
  statusCode: number;
  errors: unknown;
  constructor(control: string, zone: unknown) {
    const zoneType = (zone as {type?: unknown})?.type;
    super(
      typeof zoneType === "string" && zoneType !== "" ?
        `${control} is inside an active ${zoneType} zone` :
        `${control} is inside an active road hazard zone`,
    );
    this.statusCode = 409;
    this.errors = {control: control.toLowerCase(), zone};
  }
}

const isConflictError = (err: unknown): boolean =>
  (err as {statusCode?: unknown})?.statusCode === 409;

export {
  NotFoundError,
  RouteBlockedError,
  WidthBlockedError,
  EndpointBlockedError,
  isConflictError,
};
