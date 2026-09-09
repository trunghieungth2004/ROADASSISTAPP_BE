import {NextFunction, Request, Response} from "express";
import {SchemaMap} from "../middleware/validate";
import {Schemas} from "../validation/schemas";

type MiddlewareFn = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

interface RouteDeps {
  requireAuth: MiddlewareFn;
  requireRole: (role: string | string[]) => MiddlewareFn;
  validate: (schema: SchemaMap) => MiddlewareFn;
  schemas: Schemas;
}

export {MiddlewareFn, RouteDeps};
