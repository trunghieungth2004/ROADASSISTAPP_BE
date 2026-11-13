import * as vehicleProfileRepository from
  "../../../repository/vehicleProfileRepository";
import * as userRepository from "../../../repository/userRepository";
import * as providerRepository from
  "../../../repository/providerRepository";
import * as warrantyRepository from
  "../../../repository/warrantyRepository";
import * as vehicleHistoryRepository from
  "../../../repository/vehicleHistoryRepository";
import {
  getProfiles,
  createProfile,
  updateProfile,
  vehicleHistory,
  addRideConfig,
} from "../../../service/vehicleProfileService";

jest.mock("../../../repository/vehicleProfileRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/warrantyRepository");
jest.mock("../../../repository/vehicleHistoryRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("vehicleProfileService.createProfile", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createProfile({
        userId: "ghost",
        type: "SCOOTER",
        baseWidth: 1,
        baseHeight: 1,
      }),
    ).rejects.toMatchObject({statusCode: 404});
    expect(vehicleProfileRepository.create).not.toHaveBeenCalled();
  });

  it("creates the profile for a known user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const profile = {id: "p1", type: "SCOOTER"};
    jest.mocked(vehicleProfileRepository.create).mockResolvedValue(
      profile as never,
    );
    await expect(
      createProfile({
        userId: "u1",
        type: "SCOOTER",
        baseWidth: 0.7,
        baseHeight: 1.1,
      }),
    ).resolves.toBe(profile);
    expect(vehicleProfileRepository.create).toHaveBeenCalledWith("u1", {
      type: "SCOOTER",
      baseWidth: 0.7,
      baseHeight: 1.1,
    });
  });
});

describe("vehicleProfileService.addRideConfig", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      addRideConfig({userId: "ghost", profileId: "p1", configType: "SOLO"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("throws 404 for an unknown profile", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findById).mockResolvedValue(null);
    await expect(
      addRideConfig({userId: "u1", profileId: "ghost", configType: "SOLO"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("attaches the config to a known profile", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
      id: "p1",
    } as never);
    const config = {id: "c1", configType: "CARGO"};
    jest.mocked(vehicleProfileRepository.addRideConfig).mockResolvedValue(
      config as never,
    );
    await expect(
      addRideConfig({userId: "u1", profileId: "p1", configType: "CARGO"}),
    ).resolves.toBe(config);
  });
});

describe("vehicleProfileService.updateProfile", () => {
  it("updates the profile fields", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findById)
      .mockResolvedValueOnce({id: "p1", type: "BIKE"} as never)
      .mockResolvedValueOnce({
        id: "p1",
        type: "BIKE",
        label: "Wave",
        plate: "59-X1 123.45",
      } as never);
    const updated = await updateProfile({
      userId: "u1",
      profileId: "p1",
      label: "Wave",
      plate: "59-x1 123.45",
      baseWidth: 0.7,
    });
    expect(vehicleProfileRepository.update).toHaveBeenCalledWith(
      "u1",
      "p1",
      {label: "Wave", plate: "59-X1 123.45", baseWidth: 0.7},
    );
    expect(updated).toMatchObject({label: "Wave"});
  });
});

describe("vehicleProfileService.vehicleHistory", () => {
  it("returns resolved service lines with claim status", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
      id: "p1",
      type: "BIKE",
    } as never);
    jest.mocked(vehicleHistoryRepository.findByVehicleId)
      .mockResolvedValue([{
        id: "t1",
        userId: "u1",
        ticketType: "WALK_IN",
        status: "4",
        assignedShopId: "shop1",
        createdAt: "2026-10-01T00:00:00.000Z",
        invoiceItems: [{
          kind: "SERVICE",
          lineId: "l1",
          serviceCode: "BRAKE",
          name: "Brake pads",
          category: "BRAKES",
          qty: 1,
          unitPrice: 150000,
          amount: 150000,
          warrantyDays: 60,
          warrantyParts: "PARTS_AND_LABOR",
          warrantyUntil: "2027-01-01T00:00:00.000Z",
        }],
      }] as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop1",
      name: "Fix Shop",
    } as never);
    jest.mocked(warrantyRepository.findByRider).mockResolvedValue([{
      id: "wc1",
      ticketId: "t1",
      lineId: "l1",
      status: "OPEN",
      shopResponse: null,
      linkedTicketId: null,
      refundAmount: null,
      refundRequestId: null,
      createdAt: "2026-11-01T00:00:00.000Z",
    }] as never);
    const history = await vehicleHistory({
      userId: "u1",
      profileId: "p1",
    });
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({
      ticketId: "t1",
      providerName: "Fix Shop",
      total: 150000,
    });
    const first = history.items[0] as {
      lines: Array<Record<string, unknown>>;
    };
    expect(first.lines[0]).toMatchObject({
      lineId: "l1",
      name: "Brake pads",
      category: "BRAKES",
      qty: 1,
      unitPrice: 150000,
      warrantyDays: 60,
      warrantyParts: "PARTS_AND_LABOR",
      claim: {id: "wc1", status: "OPEN"},
    });
  });
});

describe("vehicleProfileService.getProfiles", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(getProfiles("ghost")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("lists the user profiles", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findByUser).mockResolvedValue(
      [{id: "p1"}] as never,
    );
    await expect(getProfiles("u1")).resolves.toEqual([{id: "p1"}]);
  });
});
