import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as userController from "../controller/userController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/users/register",
    validate({body: schemas.register}),
    userController.register,
  );
  app.post(
    "/users/one",
    requireAuth,
    validate({body: schemas.getOneUser}),
    userController.getOneUser,
  );
  app.post(
    "/users/all",
    requireAuth,
    requireRole("1"),
    userController.getAllUser,
  );
  app.put(
    "/users/role",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserRole}),
    userController.updateRole,
  );
  app.put(
    "/users/trust",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserTrust}),
    userController.updateTrustScore,
  );
  app.put(
    "/users/status",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserStatus}),
    userController.updateStatus,
  );
};
