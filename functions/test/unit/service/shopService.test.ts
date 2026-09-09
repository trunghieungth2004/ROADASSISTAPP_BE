import * as shopRepository from "../../../repository/shopRepository";
import * as userRepository from "../../../repository/userRepository";
import {createShop, nearShops} from "../../../service/shopService";

jest.mock("../../../repository/shopRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("shopService.createShop", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createShop({userId: "ghost", name: "S", lat: 1, lng: 2, type: "SHOP"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("creates the shop", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const shop = {id: "s1"};
    jest.mocked(shopRepository.create).mockResolvedValue(shop as never);
    await expect(
      createShop({userId: "u1", name: "S", lat: 1, lng: 2, type: "PUMP"}),
    ).resolves.toBe(shop);
    expect(shopRepository.create).toHaveBeenCalledWith({
      name: "S",
      lat: 1,
      lng: 2,
      type: "PUMP",
    });
  });
});

describe("shopService.nearShops", () => {
  const shops = [
    {id: "near", lat: 10.7626, lng: 106.6602, type: "SHOP"},
    {id: "pump", lat: 10.7627, lng: 106.6603, type: "PUMP"},
    {id: "far", lat: 11.7626, lng: 107.6602, type: "SHOP"},
  ];

  it("returns in-radius shops with distances", async () => {
    jest.mocked(shopRepository.findByGeohashPrefixes).mockResolvedValue(
      shops as never,
    );
    const result = await nearShops({lat: 10.7626, lng: 106.6602});
    expect(result.map((s) => (s as {id: string}).id).sort()).toEqual([
      "near",
      "pump",
    ]);
    for (const shop of result) {
      expect(typeof (shop as {distance: unknown}).distance).toBe("number");
    }
  });

  it("filters by type when requested", async () => {
    jest.mocked(shopRepository.findByGeohashPrefixes).mockResolvedValue(
      shops as never,
    );
    const result = await nearShops({
      lat: 10.7626,
      lng: 106.6602,
      type: "PUMP",
    });
    expect(result.map((s) => (s as {id: string}).id)).toEqual(["pump"]);
  });
});
