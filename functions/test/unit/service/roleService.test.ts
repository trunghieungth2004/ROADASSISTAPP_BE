import * as roleRepository from "../../../repository/roleRepository";
import * as userRepository from "../../../repository/userRepository";
import {getRoles, getRoleByUser} from "../../../service/roleService";

jest.mock("../../../repository/roleRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("roleService.getRoles", () => {
  it("returns every role mapping", async () => {
    const roles = [{id: "1", name: "Admin"}];
    jest.mocked(roleRepository.findAll).mockResolvedValue(roles as never);
    await expect(getRoles()).resolves.toBe(roles);
  });
});

describe("roleService.getRoleByUser", () => {
  it("throws 404 for an unknown or inactive user", async () => {
    jest.mocked(userRepository.findActiveById).mockResolvedValue(null);
    await expect(getRoleByUser("ghost")).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("resolves code plus mapping fields", async () => {
    jest.mocked(userRepository.findActiveById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    jest.mocked(roleRepository.findById).mockResolvedValue({
      id: "2",
      name: "Rider",
      description: "Standard",
    } as never);
    await expect(getRoleByUser("u1")).resolves.toEqual({
      id: "u1",
      role: "2",
      name: "Rider",
      description: "Standard",
    });
  });

  it("falls back to null mapping when roles are unseeded", async () => {
    jest.mocked(userRepository.findActiveById).mockResolvedValue({
      id: "u1",
      role: "2",
    } as never);
    jest.mocked(roleRepository.findById).mockResolvedValue(null);
    await expect(getRoleByUser("u1")).resolves.toEqual({
      id: "u1",
      role: "2",
      name: null,
      description: null,
    });
  });
});
