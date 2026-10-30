import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {SERVICE_ROLE} from "../constants/status";
import * as userController from "../controller/userController";

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/users/register",
    writeLimited,
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
    "/users/me",
    requireAuth,
    validate({body: schemas.getMe}),
    userController.getMe,
  );
  app.put(
    "/users/activeVehicle",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.setActiveVehicle}),
    userController.setActiveVehicle,
  );
  app.put(
    "/users/onboard",
    writeLimited,
    requireAuth,
    validate({body: schemas.setOnboarded}),
    userController.setOnboarded,
  );
  app.post(
    "/users/all",
    requireAuth,
    requireRole("1"),
    userController.getAllUser,
  );
  app.put(
    "/users/role",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserRole}),
    userController.updateRole,
  );
  app.put(
    "/users/trust",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserTrust}),
    userController.updateTrustScore,
  );
  app.put(
    "/users/status",
    writeLimited,
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserStatus}),
    userController.updateStatus,
  );
  app.put(
    "/users/services",
    writeLimited,
    requireAuth,
    validate({body: schemas.updateUserServices}),
    userController.updateServices,
  );
  app.put(
    "/users/profile",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.updateProfile}),
    userController.updateProfile,
  );
  app.post(
    "/users/ratings",
    writeLimited,
    requireAuth,
    validate({body: schemas.userRatings}),
    userController.userRatings,
  );
};
