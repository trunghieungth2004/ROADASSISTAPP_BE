import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import {findTowOperators} from "../../../service/dispatch/candidates";
import {mobileTowAvailabilityFor} from "../../../service/dispatch/summary";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../service/dispatch/candidates", () => ({
  findTowOperators: jest.fn(async () => ["op2"]),
}));

const ticket = {
  id: "sos1",
  userId: "rider1",
  ticketType: "SOS",
  status: "15",
  assignedShopId: "mobile1",
  lat: 10.7,
  lng: 106.6,
  vehicleType: "BIKE",
};

const mobileShop = {
  id: "mobile1",
  kind: "MOBILE_SHOP",
  operatorUid: "op1",
  status: "ACTIVE",
  accepting: true,
  vehicleProfileId: "profile1",
};

const sameTow = {
  id: "tow1",
  kind: "TOW",
  operatorUid: "op1",
  status: "ACTIVE",
  accepting: true,
  plate: "51A-12345",
  vehicleProfileId: "profile1",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.findById).mockResolvedValue(
    ticket as never,
  );
  jest.mocked(dispatchRepository.findActiveForShop).mockResolvedValue([]);
  jest.mocked(providerRepository.findById).mockResolvedValue(
    mobileShop as never,
  );
  jest.mocked(providerRepository.findByOperator).mockResolvedValue([
    mobileShop,
    sameTow,
  ] as never);
  jest.mocked(findTowOperators).mockResolvedValue(["op2"] as never);
});

describe("mobile tow availability", () => {
  test("returns DIRECT when a same-vehicle TOW is free", async () => {
    await expect(mobileTowAvailabilityFor(ticket as never)).resolves.toEqual({
      available: true,
      mode: "DIRECT",
      state: "DIRECT",
      towProviderId: "tow1",
    });
  });

  test("returns NETWORK when the linked TOW is off duty", async () => {
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      mobileShop,
      {...sameTow, accepting: false},
    ] as never);
    await expect(mobileTowAvailabilityFor(ticket as never)).resolves.toEqual({
      available: true,
      mode: "NETWORK",
      state: "TOW_OFF_DUTY",
      towProviderId: null,
    });
  });

  test("returns NETWORK when the linked TOW is busy", async () => {
    jest.mocked(dispatchRepository.findActiveForShop).mockImplementation(
      async (id) => id === "tow1" ? [{id: "other"}] as never : [],
    );
    await expect(mobileTowAvailabilityFor(ticket as never)).resolves.toEqual({
      available: true,
      mode: "NETWORK",
      state: "TOW_BUSY",
      towProviderId: null,
    });
  });

  test("returns NETWORK when no same-vehicle TOW is linked", async () => {
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      mobileShop,
    ] as never);
    await expect(mobileTowAvailabilityFor(ticket as never)).resolves.toEqual({
      available: true,
      mode: "NETWORK",
      state: "NO_TOW",
      towProviderId: null,
    });
  });

  test("hides the offer when no network tower is nearby", async () => {
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      mobileShop,
    ] as never);
    jest.mocked(findTowOperators).mockResolvedValue([] as never);
    await expect(mobileTowAvailabilityFor(ticket as never)).resolves.toEqual({
      available: false,
      mode: "NETWORK",
      state: "NONE_NEARBY",
      towProviderId: null,
    });
  });
});
