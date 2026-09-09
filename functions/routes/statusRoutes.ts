import {Express} from "express";
import * as statusController from "../controller/statusController";

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
    "/statuses",
    requireAuth,
    validate({body: schemas.getStatuses}),
    statusController.getStatuses,
  );
};
