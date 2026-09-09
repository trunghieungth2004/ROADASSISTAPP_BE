import {Express} from "express";
import * as diagnosticController from "../controller/diagnosticController";

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
    "/diagnostics",
    requireAuth,
    validate({body: schemas.createDiagnostic}),
    diagnosticController.createDiagnostic,
  );
  app.post(
    "/diagnostics/one",
    requireAuth,
    validate({body: schemas.getDiagnostic}),
    diagnosticController.getDiagnostic,
  );
};
