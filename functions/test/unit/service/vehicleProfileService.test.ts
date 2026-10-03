import * as vehicleProfileRepository from
  "../../../repository/vehicleProfileRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  getProfiles,
  createProfile,
  addRideConfig,
} from "../../../service/vehicleProfileService";

jest.mock("../../../repository/vehicleProfileRepository");
jest.mock("../../../repository/userRepository");

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
