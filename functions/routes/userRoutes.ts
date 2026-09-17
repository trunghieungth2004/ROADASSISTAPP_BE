import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {SERVICE_ROLE} from "../constants/status";
import * as userController from "../controller/userController";

export default (
  app: Express,
  {requireAuth, requireRole, requireService, validate, schemas}: RouteDeps,
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
    "/users/me",
    requireAuth,
    validate({body: schemas.getMe}),
    userController.getMe,
  );
  app.put(
    "/users/activeVehicle",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.setActiveVehicle}),
    userController.setActiveVehicle,
  );
  app.put(
    "/users/onboard",
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
  app.put(
    "/users/services",
    requireAuth,
    requireRole("1"),
    validate({body: schemas.updateUserServices}),
    userController.updateServices,
  );
  app.put(
    "/users/profile",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.updateProfile}),
    userController.updateProfile,
  );
  app.put(
    "/users/volunteer",
    requireAuth,
    requireService(SERVICE_ROLE.VOLUNTEER),
    validate({body: schemas.volunteerToggle}),
    userController.setVolunteerAvailability,
  );
  app.post(
    "/users/volunteer/heartbeat",
    requireAuth,
    requireService(SERVICE_ROLE.VOLUNTEER),
    validate({body: schemas.volunteerHeartbeat}),
    userController.volunteerHeartbeat,
  );
  app.post(
    "/users/volunteers/sweep",
    requireAuth,
    requireRole("1"),
    userController.sweepVolunteers,
  );
};
