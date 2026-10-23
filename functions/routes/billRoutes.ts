import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as billController from "../controller/billController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/bills/all",
    requireAuth,
    validate({body: schemas.billsAll}),
    billController.listAll,
  );
  app.post(
    "/bills/payee",
    requireAuth,
    validate({body: schemas.billsAll}),
    billController.listPayee,
  );
  app.post(
    "/bills/one",
    requireAuth,
    validate({body: schemas.billOne}),
    billController.getOne,
  );
};
