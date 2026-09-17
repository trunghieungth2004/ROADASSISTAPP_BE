import {Express} from "express";
import {RouteDeps} from "../types/routes";
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
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.createVehicleProfile}),
    vehicleProfileController.createProfile,
  );
  app.post(
    "/vehicleProfiles/rideConfig",
    requireAuth,
    requireService(SERVICE_ROLE.RIDER),
    validate({body: schemas.addRideConfig}),
    vehicleProfileController.addRideConfig,
  );
  app.put(
    "/vehicleProfiles/tow",
    requireAuth,
    requireService(SERVICE_ROLE.TOW),
    validate({body: schemas.setTowVehicle}),
    vehicleProfileController.setTowVehicle,
  );
};
