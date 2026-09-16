import * as shopRepository from "../../../repository/shopRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  createShop,
  updateShop,
  myShops,
  nearShops,
  isOpenNow,
} from "../../../service/shopService";

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
      createShop({userId: "u1", name: "S", lat: 1, lng: 2, type: "MOBILE"}),
    ).resolves.toBe(shop);
    expect(shopRepository.create).toHaveBeenCalledWith({
      name: "S",
      lat: 1,
      lng: 2,
      type: "MOBILE",
      openHours: undefined,
      hasTow: undefined,
      operatorUid: "u1",
    });
  });

  it("creates tow providers", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const shop = {id: "s2"};
    jest.mocked(shopRepository.create).mockResolvedValue(shop as never);
    await createShop({
      userId: "u1",
      name: "Tow",
      lat: 1,
      lng: 2,
      type: "TOW",
      openHours: "00:00-23:59",
    });
    expect(shopRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({type: "TOW"}),
    );
  });
});

describe("shopService.updateShop", () => {
  it("throws 404 for an unknown shop", async () => {
    jest.mocked(shopRepository.findById).mockResolvedValue(null);
    await expect(
      updateShop({userId: "u1", shopId: "ghost", fields: {}}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("rejects strangers with 403", async () => {
    jest.mocked(shopRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      updateShop({
        userId: "stranger",
        shopId: "s1",
        fields: {accepting: false},
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("lets the operator toggle availability", async () => {
    jest.mocked(shopRepository.findById).mockResolvedValue({
      id: "s1",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      updateShop({
        userId: "op1",
        shopId: "s1",
        fields: {accepting: false},
      }),
    ).resolves.toEqual({updated: 1});
    expect(shopRepository.update).toHaveBeenCalledWith("s1", {
      accepting: false,
    });
  });
});

describe("shopService.isOpenNow", () => {
  const noon = new Date(2026, 5, 15, 12, 0, 0);
  const night = new Date(2026, 5, 15, 23, 30, 0);
  const tueEarly = new Date(2026, 5, 16, 2, 0, 0);

  it("returns null without hours", () => {
    expect(isOpenNow(null, noon)).toBeNull();
    expect(isOpenNow(undefined, noon)).toBeNull();
    expect(isOpenNow("nope", noon)).toBeNull();
  });

  it("handles daytime ranges", () => {
    expect(isOpenNow("MON 06:00-22:00", noon)).toBe(true);
    expect(isOpenNow("MON 13:00-22:00", noon)).toBe(false);
  });

  it("treats days without an entry as closed", () => {
    expect(isOpenNow("TUE 06:00-22:00", noon)).toBe(false);
  });

  it("handles overnight ranges", () => {
    expect(isOpenNow("MON 22:00-06:00", night)).toBe(true);
    expect(isOpenNow("MON 22:00-06:00", noon)).toBe(false);
  });

  it("covers overnight spillover into the next day", () => {
    expect(isOpenNow("MON 22:00-06:00", tueEarly)).toBe(true);
    expect(isOpenNow("TUE 22:00-06:00", tueEarly)).toBe(false);
  });

  it("treats the legacy single interval as every day", () => {
    expect(isOpenNow("06:00-22:00", noon)).toBe(true);
    expect(isOpenNow("06:00-22:00", tueEarly)).toBe(false);
  });
});

describe("shopService.nearShops", () => {
  const noon = new Date(2026, 5, 15, 12, 0, 0);
  const shops = [
    {id: "near", lat: 10.7626, lng: 106.6602, type: "SHOP",
      openHours: "MON 00:00-23:59", accepting: true},
    {id: "mobile", lat: 10.7627, lng: 106.6603, type: "MOBILE",
      openHours: null, accepting: true},
    {id: "closed", lat: 10.7626, lng: 106.6602, type: "SHOP",
      openHours: "MON 00:00-00:01", accepting: true},
    {id: "off", lat: 10.7626, lng: 106.6602, type: "SHOP",
      openHours: "MON 00:00-00:01", accepting: false},
    {id: "far", lat: 11.7626, lng: 107.6602, type: "SHOP",
      openHours: "MON 00:00-23:59", accepting: true},
  ];

  it("returns in-radius shops with distances", async () => {
    jest.mocked(shopRepository.findByGeohashPrefixes).mockResolvedValue(
      shops as never,
    );
    const result = await nearShops({lat: 10.7626, lng: 106.6602});
    expect(result.map((s) => (s as {id: string}).id).sort()).toEqual([
      "closed",
      "mobile",
      "near",
      "off",
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
      type: "MOBILE",
    });
    expect(result.map((s) => (s as {id: string}).id)).toEqual(["mobile"]);
  });

  it("sorts nearest first and caps the list", async () => {
    jest.mocked(shopRepository.findByGeohashPrefixes).mockResolvedValue(
      shops as never,
    );
    const result = await nearShops({
      lat: 10.7626,
      lng: 106.6602,
      limit: 2,
    });
    expect(result).toHaveLength(2);
    const distances = result.map(
      (s) => (s as {distance: number}).distance,
    );
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    for (const shop of result) {
      expect(typeof (shop as {openNow: unknown}).openNow).not.toBe(
        "undefined",
      );
    }
  });

  it("filters to accepting shops on request", async () => {
    jest.mocked(shopRepository.findByGeohashPrefixes).mockResolvedValue(
      shops as never,
    );
    const result = await nearShops({
      lat: 10.7626,
      lng: 106.6602,
      acceptingOnly: true,
    });
    expect(
      result.map((s) => (s as {id: string}).id),
    ).not.toContain("off");
  });

  it("filters to open shops on request", async () => {
    jest.mocked(shopRepository.findByGeohashPrefixes).mockResolvedValue(
      shops as never,
    );
    const result = await nearShops({
      lat: 10.7626,
      lng: 106.6602,
      openOnly: true,
      now: noon,
    });
    expect(result.map((s) => (s as {id: string}).id)).toEqual(["near"]);
  });
});

describe("shopService tow vehicles", () => {
  it("stores the tow vehicle on create", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(shopRepository.create).mockResolvedValue({
      id: "s3",
    } as never);
    await createShop({
      userId: "u1",
      name: "Tow",
      lat: 1,
      lng: 2,
      type: "TOW",
      hasTow: true,
      towVehicleType: "TRUCK",
      towVehicleWidth: 2.3,
    });
    expect(shopRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TOW",
        towVehicleType: "TRUCK",
        towVehicleWidth: 2.3,
      }),
    );
  });

  it("patches the tow vehicle on update", async () => {
    jest.mocked(shopRepository.findById).mockResolvedValue({
      id: "s3",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    await expect(
      updateShop({
        userId: "op1",
        shopId: "s3",
        fields: {towVehicleType: "VAN", towVehicleWidth: 2.0},
      }),
    ).resolves.toEqual({updated: 1});
    expect(shopRepository.update).toHaveBeenCalledWith("s3", {
      towVehicleType: "VAN",
      towVehicleWidth: 2.0,
    });
  });
});

describe("shopService.myShops", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(myShops({userId: "ghost"})).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("returns only the caller operated shops", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const owned = [{id: "s1", operatorUid: "u1"}];
    jest.mocked(shopRepository.findByOperator).mockResolvedValue(
      owned as never,
    );
    await expect(myShops({userId: "u1"})).resolves.toBe(owned);
    expect(shopRepository.findByOperator).toHaveBeenCalledWith("u1");
  });
});
