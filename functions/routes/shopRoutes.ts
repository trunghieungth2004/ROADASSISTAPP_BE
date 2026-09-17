import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as shopController from "../controller/shopController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/shops",
    requireAuth,
    requireService(SERVICE_ROLE.SHOP),
    validate({body: schemas.createShop}),
    shopController.createShop,
  );
  app.post(
    "/shops/near",
    requireAuth,
    validate({body: schemas.nearShops}),
    shopController.nearShops,
  );
  app.post(
    "/shops/mine",
    requireAuth,
    validate({body: schemas.myShops}),
    shopController.myShops,
  );
  app.put(
    "/shops",
    requireAuth,
    requireService(SERVICE_ROLE.SHOP),
    validate({body: schemas.updateShop}),
    shopController.updateShop,
  );
};
