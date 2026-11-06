import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as warrantyController from "../controller/warrantyController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/warranty/claims",
    writeLimited,
    requireAuth,
    validate({body: schemas.warrantyFile}),
    warrantyController.file,
  );
  app.post(
    "/warranty/mine",
    requireAuth,
    validate({body: schemas.warrantyMine}),
    warrantyController.mine,
  );
  app.post(
    "/warranty/shop",
    requireAuth,
    validate({body: schemas.warrantyShop}),
    warrantyController.shop,
  );
  app.post(
    "/warranty/respond",
    writeLimited,
    requireAuth,
    validate({body: schemas.warrantyRespond}),
    warrantyController.respond,
  );
  app.post(
    "/warranty/dispute",
    writeLimited,
    requireAuth,
    validate({body: schemas.warrantyDispute}),
    warrantyController.dispute,
  );
};
