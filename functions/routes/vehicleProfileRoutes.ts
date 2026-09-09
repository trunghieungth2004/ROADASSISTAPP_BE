import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as vehicleProfileController from
  "../controller/vehicleProfileController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
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
    validate({body: schemas.createVehicleProfile}),
    vehicleProfileController.createProfile,
  );
  app.post(
    "/vehicleProfiles/rideConfig",
    requireAuth,
    validate({body: schemas.addRideConfig}),
    vehicleProfileController.addRideConfig,
  );
};
