import {VEHICLE_TYPE} from "../constants/status";

const normalizeVehicleType = (
  value: unknown,
): string | null => {
  if (typeof value !== "string" || value === "") return null;
  if (value === VEHICLE_TYPE.CAR) return VEHICLE_TYPE.CAR;
  if (value === VEHICLE_TYPE.BIKE) return VEHICLE_TYPE.BIKE;
  if (value === "VAN" || value === "TRUCK") return VEHICLE_TYPE.CAR;
  if (value === "SCOOTER" || value === "CUB" || value === "MANUAL") {
    return VEHICLE_TYPE.BIKE;
  }
  return null;
};

export {normalizeVehicleType};
