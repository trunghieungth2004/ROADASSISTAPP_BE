import {Express} from "express";
import * as shopController from "../controller/shopController";

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
    "/shops",
    requireAuth,
    validate({body: schemas.createShop}),
    shopController.createShop,
  );
  app.post(
    "/shops/near",
    requireAuth,
    validate({body: schemas.nearShops}),
    shopController.nearShops,
  );
};
