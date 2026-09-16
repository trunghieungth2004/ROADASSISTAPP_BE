import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as shopController from "../controller/shopController";

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
  app.post(
    "/shops/mine",
    requireAuth,
    validate({body: schemas.myShops}),
    shopController.myShops,
  );
  app.put(
    "/shops",
    requireAuth,
    validate({body: schemas.updateShop}),
    shopController.updateShop,
  );
};
