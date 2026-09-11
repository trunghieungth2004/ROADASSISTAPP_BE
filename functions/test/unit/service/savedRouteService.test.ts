import * as savedRouteRepository from
  "../../../repository/savedRouteRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  saveRoute,
  listRoutes,
  getRoute,
  renameRoute,
  deleteRoute,
} from "../../../service/savedRouteService";

jest.mock("../../../repository/savedRouteRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

const geometry = {type: "LineString", coordinates: [[106.6, 10.7]]};
const input = {
  userId: "u1",
  originLat: 10.7,
  originLng: 106.6,
  destLat: 10.8,
  destLng: 106.7,
  geometry,
};

describe("savedRouteService.saveRoute", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(saveRoute(input)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(savedRouteRepository.create).not.toHaveBeenCalled();
  });

  it("trims the name and falls back when blank", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(savedRouteRepository.create).mockResolvedValue({
      id: "r1",
    } as never);
    await saveRoute({...input, name: "  Home run  "});
    expect(savedRouteRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({name: "Home run", userId: "u1"}),
    );
    await saveRoute({...input, name: "   "});
    expect(savedRouteRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({name: "Saved route"}),
    );
  });
});

describe("savedRouteService ownership", () => {
  it("returns null for unknown routes", async () => {
    jest.mocked(savedRouteRepository.findById).mockResolvedValue(null);
    await expect(
      getRoute({routeId: "ghost", userId: "u1"}),
    ).resolves.toBeNull();
    await expect(
      renameRoute({routeId: "ghost", userId: "u1", name: "x"}),
    ).resolves.toBeNull();
    await expect(
      deleteRoute({routeId: "ghost", userId: "u1"}),
    ).resolves.toBeNull();
  });

  it.each([
    ["getRoute", () => getRoute({routeId: "r1", userId: "u2"})],
    [
      "renameRoute",
      () => renameRoute({routeId: "r1", userId: "u2", name: "x"}),
    ],
    ["deleteRoute", () => deleteRoute({routeId: "r1", userId: "u2"})],
  ])("%s throws 403 for a non-owner", async (_label, call) => {
    jest.mocked(savedRouteRepository.findById).mockResolvedValue({
      id: "r1",
      userId: "u1",
    } as never);
    await expect(call()).rejects.toMatchObject({statusCode: 403});
  });

  it("renames and deletes the owner's route", async () => {
    jest.mocked(savedRouteRepository.findById).mockResolvedValue({
      id: "r1",
      userId: "u1",
    } as never);
    jest.mocked(savedRouteRepository.updateName).mockResolvedValue(undefined);
    jest.mocked(savedRouteRepository.deleteById).mockResolvedValue(undefined);
    await expect(
      renameRoute({routeId: "r1", userId: "u1", name: "  Work  "}),
    ).resolves.toEqual({renamed: 1});
    expect(savedRouteRepository.updateName).toHaveBeenCalledWith(
      "r1",
      "Work",
    );
    await expect(
      deleteRoute({routeId: "r1", userId: "u1"}),
    ).resolves.toEqual({deleted: 1});
    expect(savedRouteRepository.deleteById).toHaveBeenCalledWith("r1");
  });

  it("lists summaries without geometry", async () => {
    jest.mocked(savedRouteRepository.listByUserId).mockResolvedValue([
      {
        id: "r1",
        userId: "u1",
        name: "A",
        originLat: 1,
        originLng: 2,
        destLat: 3,
        destLng: 4,
        stops: [],
        createdAt: "t",
        updatedAt: "t",
        geometry: {heavy: true},
        hazards: [{x: 1}],
      },
    ] as never);
    const result = await listRoutes("u1");
    expect(savedRouteRepository.listByUserId).toHaveBeenCalledWith("u1");
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("geometry");
    expect(result[0]).not.toHaveProperty("hazards");
    expect(result[0]).toMatchObject({id: "r1", name: "A"});
  });
});
