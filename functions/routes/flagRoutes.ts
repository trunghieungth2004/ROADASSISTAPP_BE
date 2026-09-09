import {Express} from "express";
import * as flagController from "../controller/flagController";

interface RouteDeps {
  requireAuth: (req: any, res: any, next: any) => void;
  requireRole: (
    role: string | string[],
  ) => (req: any, res: any, next: any) => void;
  validate: (schema: any) => (req: any, res: any, next: any) => void;
  schemas: Record<string, unknown>;
}

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/flags",
    requireAuth,
    validate({body: schemas.createFlag}),
    flagController.createFlag,
  );
  app.post(
    "/flags/confirm",
    requireAuth,
    validate({body: schemas.confirmFlag}),
    flagController.confirmFlag,
  );
  app.post(
    "/flags/near",
    requireAuth,
    validate({body: schemas.getFlagsNear}),
    flagController.getNear,
  );
  app.put(
    "/flags/moderate",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.moderateFlag}),
    flagController.moderateFlag,
  );
  app.post(
    "/flags/expire",
    requireAuth,
    requireRole("1"),
    flagController.expireFlags,
  );
};
