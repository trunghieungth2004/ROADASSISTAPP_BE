import * as userRepository from "../../../repository/userRepository";
import * as vehicleProfileRepository from
  "../../../repository/vehicleProfileRepository";
import * as volunteerLocationRepository from
  "../../../repository/volunteerLocationRepository";
import * as shopRepository from "../../../repository/shopRepository";
import * as cacheManager from "../../../utils/cacheManager";
import {
  register,
  getOneUser,
  getAllUser,
  updateRole,
  updateTrustScore,
  updateStatus,
  updateProfile,
  setVolunteerAvailability,
  volunteerHeartbeat,
  setActiveVehicle,
  setOnboarded,
  updateServices,
  me,
} from "../../../service/userService";

jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/vehicleProfileRepository");
jest.mock("../../../repository/volunteerLocationRepository");
jest.mock("../../../repository/shopRepository");

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(cacheManager, "del").mockImplementation(() => undefined);
});

describe("userService.register", () => {
  it("creates an active rider with zero trust", async () => {
    jest.mocked(userRepository.create).mockResolvedValue(undefined);
    const result = await register(
      {email: "r@x.co", password: "secret123", phone: "+10000000001"});
    expect(result).toEqual({uid: "mock-uid"});
    expect(userRepository.create).toHaveBeenCalledWith("mock-uid", {
      email: "r@x.co",
      displayName: undefined,
      role: "2",
      phone: "+10000000001",
      services: ["RIDER"],
    });
  });
});

describe("userService.getOneUser", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(getOneUser("ghost")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns the user document", async () => {
    const user = {id: "u1", role: "2"};
    jest.mocked(userRepository.findById).mockResolvedValue(user as never);
    await expect(getOneUser("u1")).resolves.toBe(user);
  });
});

describe("userService.getAllUser", () => {
  it("returns every user", async () => {
    jest.mocked(userRepository.findAll).mockResolvedValue(
      [{id: "u1"}] as never,
    );
    await expect(getAllUser()).resolves.toEqual([{id: "u1"}]);
  });
});

describe("userService.updateRole", () => {
  it("blocks self role changes with 400", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "1",
    } as never);
    await expect(
      updateRole({actorId: "u1", targetUserId: "u1", role: "2"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(userRepository.updateRole).not.toHaveBeenCalled();
  });

  it("throws 404 for an unknown target", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      updateRole({actorId: "admin", targetUserId: "ghost", role: "1"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("updates and invalidates the target and list caches", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u2",
      role: "2",
    } as never);
    jest.mocked(userRepository.updateRole).mockResolvedValue(undefined);
    await expect(
      updateRole({actorId: "admin", targetUserId: "u2", role: "1"}),
    ).resolves.toEqual({updated: 1});
    expect(userRepository.updateRole).toHaveBeenCalledWith("u2", "1");
    expect(cacheManager.del).toHaveBeenCalledWith("user", "u2");
    expect(cacheManager.del).toHaveBeenCalledWith("user", "__all__");
  });
});

describe("userService.updateProfile", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      updateProfile({userId: "ghost", displayName: "Ghost"}),
    ).rejects.toMatchObject({statusCode: 404});
    expect(userRepository.updateProfile).not.toHaveBeenCalled();
  });

  it("updates the name and invalidates the caches", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(userRepository.updateProfile).mockResolvedValue(undefined);
    await expect(
      updateProfile({userId: "u1", displayName: "New Name"}),
    ).resolves.toEqual({updated: 1});
    expect(userRepository.updateProfile).toHaveBeenCalledWith(
      "u1",
      "New Name",
    );
    expect(cacheManager.del).toHaveBeenCalledWith("user", "u1");
    expect(cacheManager.del).toHaveBeenCalledWith("user", "__all__");
  });
});

describe("userService.updateTrustScore", () => {
  it("throws 404 for an unknown target", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      updateTrustScore({targetUserId: "ghost", trustScore: 10}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("writes the new score", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u2",
    } as never);
    jest.mocked(userRepository.updateTrustScore).mockResolvedValue(undefined);
    await expect(
      updateTrustScore({targetUserId: "u2", trustScore: 60}),
    ).resolves.toEqual({updated: 1});
    expect(userRepository.updateTrustScore).toHaveBeenCalledWith("u2", 60);
  });
});

describe("userService.updateStatus", () => {
  it("blocks self status changes with 400", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      updateStatus({actorId: "u1", targetUserId: "u1", status: "0"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(userRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("updates and invalidates caches", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u2",
    } as never);
    jest.mocked(userRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateStatus({actorId: "admin", targetUserId: "u2", status: "0"}),
    ).resolves.toEqual({updated: 1});
    expect(userRepository.updateStatus).toHaveBeenCalledWith("u2", "0");
    expect(cacheManager.del).toHaveBeenCalledWith("user", "u2");
  });
});

describe("userService.setVolunteerAvailability", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      setVolunteerAvailability({userId: "ghost", available: true}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("opts the user in without a location row", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      setVolunteerAvailability({userId: "u1", available: true}),
    ).resolves.toEqual({updated: 1, available: true});
    expect(userRepository.updateVolunteer).toHaveBeenCalledWith("u1", {
      volunteerAvailable: true,
    });
    expect(volunteerLocationRepository.remove).not.toHaveBeenCalled();
  });

  it("removes the location row on opt-out", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      setVolunteerAvailability({userId: "u1", available: false}),
    ).resolves.toEqual({updated: 1, available: false});
    expect(volunteerLocationRepository.remove).toHaveBeenCalledWith(
      "u1",
    );
  });

  it("stores the volunteer capability on opt-in", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      setVolunteerAvailability({
        userId: "u1",
        available: true,
        capability: "CAR",
      }),
    ).resolves.toEqual({updated: 1, available: true});
    expect(userRepository.updateVolunteer).toHaveBeenCalledWith("u1", {
      volunteerAvailable: true,
      capability: "CAR",
    });
  });
});

describe("userService.volunteerHeartbeat", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      volunteerHeartbeat({userId: "ghost", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("rejects heartbeats without the volunteer license", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["RIDER"],
      volunteerAvailable: true,
    } as never);
    await expect(
      volunteerHeartbeat({userId: "u1", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(volunteerLocationRepository.upsert).not.toHaveBeenCalled();
  });

  it("rejects heartbeats with volunteer mode off", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["VOLUNTEER"],
      volunteerAvailable: false,
    } as never);
    await expect(
      volunteerHeartbeat({userId: "u1", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(volunteerLocationRepository.upsert).not.toHaveBeenCalled();
  });

  it("refreshes the volunteer location", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["VOLUNTEER"],
      volunteerAvailable: true,
    } as never);
    jest.mocked(volunteerLocationRepository.upsert).mockResolvedValue({
      uid: "u1",
    } as never);
    await expect(
      volunteerHeartbeat({userId: "u1", lat: 1, lng: 2}),
    ).resolves.toEqual({uid: "u1"});
  });
});

describe("userService.me", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(me("ghost")).rejects.toMatchObject({statusCode: 404});
  });

  it("returns user, vehicles and null active vehicle by default", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
      activeVehicleId: null,
      onboarded: false,
    } as never);
    jest.mocked(vehicleProfileRepository.findByUser).mockResolvedValue([
      {id: "v1", type: "SCOOTER", baseWidth: 0.7, baseHeight: 1.1},
    ] as never);
    const result = await me("u1");
    expect(result.user.onboarded).toBe(false);
    expect(result.vehicles).toHaveLength(1);
    expect(result.activeVehicle).toBeNull();
  });

  it("resolves the persisted active vehicle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
      activeVehicleId: "v2",
      onboarded: true,
      services: ["RIDER"],
    } as never);
    jest.mocked(vehicleProfileRepository.findByUser).mockResolvedValue([
      {id: "v1", type: "SCOOTER", baseWidth: 0.7, baseHeight: 1.1},
      {id: "v2", type: "CAR", baseWidth: 1.9, baseHeight: 1.5},
    ] as never);
    const result = await me("u1");
    expect(result.activeVehicle).toMatchObject({id: "v2", type: "CAR"});
    expect(result.user.onboarded).toBe(true);
    expect(result.user.services).toEqual(["RIDER"]);
  });

  it("ignores a stale active vehicle id", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      role: "2",
      activeVehicleId: "missing",
    } as never);
    jest.mocked(vehicleProfileRepository.findByUser).mockResolvedValue([]);
    const result = await me("u1");
    expect(result.activeVehicle).toBeNull();
  });
});

describe("userService.setActiveVehicle", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      setActiveVehicle({userId: "ghost", profileId: "v1"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("throws 404 for a profile that is not the user's", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findById).mockResolvedValue(null);
    await expect(
      setActiveVehicle({userId: "u1", profileId: "v9"}),
    ).rejects.toMatchObject({statusCode: 404});
    expect(userRepository.updateActiveVehicle).not.toHaveBeenCalled();
  });

  it("persists the active profile", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
      id: "v1",
    } as never);
    await expect(
      setActiveVehicle({userId: "u1", profileId: "v1"}),
    ).resolves.toEqual({updated: 1, profileId: "v1"});
    expect(userRepository.updateActiveVehicle).toHaveBeenCalledWith(
      "u1",
      "v1",
    );
  });

  it("clears the active vehicle", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      setActiveVehicle({userId: "u1", profileId: null}),
    ).resolves.toEqual({updated: 1, profileId: null});
    expect(userRepository.updateActiveVehicle).toHaveBeenCalledWith(
      "u1",
      null,
    );
  });
});

describe("userService.setOnboarded", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      setOnboarded({userId: "ghost", role: "RIDER"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("marks onboarding and accumulates service roles", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      onboarded: true,
      services: ["RIDER"],
    } as never);
    await expect(
      setOnboarded({userId: "u1", role: "VOLUNTEER"}),
    ).resolves.toEqual({
      updated: 1,
      onboarded: true,
      services: ["RIDER", "VOLUNTEER"],
    });
    expect(userRepository.updateOnboarded).toHaveBeenCalledWith("u1", {
      onboarded: true,
      services: ["RIDER", "VOLUNTEER"],
    });
  });

  it("does not duplicate an existing service role", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["RIDER"],
    } as never);
    await expect(
      setOnboarded({userId: "u1", role: "RIDER"}),
    ).resolves.toEqual({
      updated: 1,
      onboarded: true,
      services: ["RIDER"],
    });
  });

  it("accepts the renamed service field", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["RIDER"],
    } as never);
    await expect(
      setOnboarded({userId: "u1", service: "SHOP"}),
    ).resolves.toEqual({
      updated: 1,
      onboarded: true,
      services: ["RIDER", "SHOP"],
    });
  });

  it("rejects unknown service licenses", async () => {
    await expect(
      setOnboarded({userId: "u1", service: "PILOT"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(userRepository.findById).not.toHaveBeenCalled();
  });

  it("rejects onboarding without any license field", async () => {
    await expect(
      setOnboarded({userId: "u1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(userRepository.findById).not.toHaveBeenCalled();
  });
});

describe("userService.updateServices", () => {
  it("throws 404 for an unknown target", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      updateServices({targetUserId: "ghost", grant: ["VOLUNTEER"]}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("grants and revokes licenses while preserving onboarded", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      onboarded: true,
      services: ["RIDER", "VOLUNTEER"],
    } as never);
    await expect(
      updateServices(
        {targetUserId: "u1", grant: ["SHOP"], revoke: ["VOLUNTEER"]}),
    ).resolves.toEqual({
      updated: 1,
      services: ["RIDER", "SHOP"],
      unlistedShops: 0,
      volunteerCleared: true,
    });
    expect(userRepository.updateOnboarded).toHaveBeenCalledWith("u1", {
      onboarded: true,
      services: ["RIDER", "SHOP"],
    });
    expect(userRepository.updateVolunteer).toHaveBeenCalledWith("u1", {
      volunteerAvailable: false,
    });
    expect(volunteerLocationRepository.remove).toHaveBeenCalledWith("u1");
  });

  it("unlists accepting shops when SHOP is revoked", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      onboarded: true,
      services: ["RIDER", "SHOP"],
    } as never);
    jest.mocked(shopRepository.findByOperator).mockResolvedValue([
      {id: "s1", accepting: true},
      {id: "s2", accepting: false},
    ] as never);
    await expect(
      updateServices({targetUserId: "u1", revoke: ["SHOP"]}),
    ).resolves.toMatchObject({
      updated: 1,
      services: ["RIDER"],
      unlistedShops: 1,
      volunteerCleared: false,
    });
    expect(shopRepository.update).toHaveBeenCalledTimes(1);
    expect(shopRepository.update).toHaveBeenCalledWith("s1", {
      accepting: false,
    });
  });

  it("skips shop writes when SHOP was never held", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["RIDER"],
    } as never);
    await expect(
      updateServices({targetUserId: "u1", revoke: ["SHOP"]}),
    ).resolves.toMatchObject({unlistedShops: 0});
    expect(shopRepository.findByOperator).not.toHaveBeenCalled();
    expect(shopRepository.update).not.toHaveBeenCalled();
  });

  it("rejects unknown licenses", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
      services: ["RIDER"],
    } as never);
    await expect(
      updateServices({targetUserId: "u1", grant: ["PILOT"]}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(userRepository.updateOnboarded).not.toHaveBeenCalled();
  });
});
