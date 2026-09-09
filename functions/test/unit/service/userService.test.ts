import * as userRepository from "../../../repository/userRepository";
import * as cacheManager from "../../../utils/cacheManager";
import {
  register,
  getOneUser,
  getAllUser,
  updateRole,
  updateTrustScore,
  updateStatus,
} from "../../../service/userService";

jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(cacheManager, "del").mockImplementation(() => undefined);
});

describe("userService.register", () => {
  it("creates an active rider with zero trust", async () => {
    jest.mocked(userRepository.create).mockResolvedValue(undefined);
    const result = await register({email: "r@x.co", password: "secret123"});
    expect(result).toEqual({uid: "mock-uid"});
    expect(userRepository.create).toHaveBeenCalledWith("mock-uid", {
      email: "r@x.co",
      displayName: undefined,
      role: "2",
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
      updateStatus({actorId: "u1", targetUserId: "u1", status: false}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(userRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("updates and invalidates caches", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u2",
    } as never);
    jest.mocked(userRepository.updateStatus).mockResolvedValue(undefined);
    await expect(
      updateStatus({actorId: "admin", targetUserId: "u2", status: false}),
    ).resolves.toEqual({updated: 1});
    expect(userRepository.updateStatus).toHaveBeenCalledWith("u2", false);
    expect(cacheManager.del).toHaveBeenCalledWith("user", "u2");
  });
});
