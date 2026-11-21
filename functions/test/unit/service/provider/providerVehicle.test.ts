import {expect, jest, test, beforeEach} from "@jest/globals";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from "../../../../repository/vehicleProfileRepository";
import {ensureProviderVehicleProfile} from "../../../../service/provider/vehicle";

jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/vehicleProfileRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

test("approval creates a linked vehicle with provider details", async () => {
  jest.mocked(vehicleProfileRepository.findByPlate).mockResolvedValue(null);
  jest.mocked(vehicleProfileRepository.create).mockResolvedValue({id: "vp1"} as never);
  const id = await ensureProviderVehicleProfile({
    id: "tow1",
    kind: "TOW",
    operatorUid: "u1",
    plate: "30A12345",
    plateRaw: "30A-12345",
    vehicleType: "CAR",
    vehicleLabel: "Tow truck",
    vehicleWidth: 2.1,
    vehicleHeight: 1.8,
    vehicleProfileId: null,
  });
  expect(id).toBe("vp1");
  expect(vehicleProfileRepository.create).toHaveBeenCalledWith("u1", {
    type: "CAR",
    baseWidth: 2.1,
    baseHeight: 1.8,
    plate: "30A-12345",
    label: "Tow truck",
  });
  expect(providerRepository.update).toHaveBeenCalledWith("tow1", {vehicleProfileId: "vp1"});
});

test("approval reuses an existing vehicle with the same plate", async () => {
  jest.mocked(vehicleProfileRepository.findByPlate).mockResolvedValue({id: "vp2"} as never);
  const id = await ensureProviderVehicleProfile({
    id: "mobile1",
    kind: "MOBILE_SHOP",
    operatorUid: "u1",
    plate: "51H12345",
    vehicleType: "BIKE",
    vehicleWidth: 0.7,
    vehicleHeight: 1.1,
    vehicleProfileId: null,
  });
  expect(id).toBe("vp2");
  expect(vehicleProfileRepository.update).toHaveBeenCalledWith("u1", "vp2", {
    type: "BIKE",
    baseWidth: 0.7,
    baseHeight: 1.1,
    plate: "51H12345",
  });
  expect(providerRepository.update).toHaveBeenCalledWith("mobile1", {vehicleProfileId: "vp2"});
});

test("shop and unresolved plates do not create vehicles", async () => {
  expect(await ensureProviderVehicleProfile({
    id: "shop1",
    kind: "SHOP",
    operatorUid: "u1",
  })).toBeNull();
  expect(await ensureProviderVehicleProfile({
    id: "tow1",
    kind: "TOW",
    operatorUid: "u1",
    plate: "",
    vehicleType: "CAR",
  })).toBeNull();
  expect(vehicleProfileRepository.create).not.toHaveBeenCalled();
});
