import {Express} from "express";
import * as vehicleProfileController from
  "../controller/vehicleProfileController";

interface RouteDeps {
  requireAuth: (req: any, res: any, next: any) => void;
  requireRole: (
    role: string | string[],
  ) => (req: any, res: any, next: any) => void;
  validate: (schema: any) => (req: any, res: any, next: any) => void;
  schemas: Record<string, unknown>;
}

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
