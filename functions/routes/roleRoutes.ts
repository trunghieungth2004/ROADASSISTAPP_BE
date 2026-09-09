import {Express} from "express";
import * as roleController from "../controller/roleController";

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
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/roles/all",
    requireAuth,
    validate({body: schemas.getRoles}),
    roleController.getRoles,
  );
  app.post(
    "/roles/user",
    requireAuth,
    validate({body: schemas.getRoleByUser}),
    roleController.getRoleByUser,
  );
};
