import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {SERVICE_ROLE} from "../constants/status";
import * as vehicleProfileController from
  "../controller/vehicleProfileController";

export default (
  app: Express,
  {requireAuth, requireService, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/vehicleProfiles/all",
    requireAuth,
    validate({body: schemas.getAllVehicleProfiles}),
    vehicleProfileController.getAllProfiles,
  );
  app.post(
    "/vehicleProfiles",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createVehicleProfile}),
    vehicleProfileController.createProfile,
  );
  app.post(
    "/vehicleProfiles/remove",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.removeVehicleProfile}),
    vehicleProfileController.removeProfile,
  );
  app.post(
    "/vehicleProfiles/rideConfig",
    writeLimited,
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.addRideConfig}),
    vehicleProfileController.addRideConfig,
  );
};
