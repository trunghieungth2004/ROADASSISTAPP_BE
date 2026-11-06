import {expect, jest, test, beforeEach} from "@jest/globals";
import * as providerRepository from "../../../../repository/providerRepository";
import * as providerLocationRepository from
  "../../../../repository/providerLocationRepository";
import {assertNearTowDestination} from
  "../../../../service/dispatch/tickets/deliveryGuard";

jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/providerLocationRepository");

const ticket = (patch: Record<string, unknown> = {}) => ({
  ticketType: "TOW",
  assignedShopId: "tow1",
  destinationShopId: "shop1",
  ...patch,
} as never);

const fix = (lat: number, lng: number) => new Map([[
  "tow1",
  {
    providerId: "tow1",
    lat,
    lng,
    geoHash: "w3gv",
    geoCell: "w3gv",
    lastSeen: new Date().toISOString(),
  },
]]) as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop1",
    lat: 10.7,
    lng: 106.7,
  } as never);
});

test("accepts delivery near the drop-off point", async () => {
  jest.mocked(providerLocationRepository.findByIds)
    .mockResolvedValue(fix(10.7005, 106.7005));
  await expect(assertNearTowDestination(ticket())).resolves.toBeUndefined();
});

test("rejects delivery far from the drop-off point", async () => {
  jest.mocked(providerLocationRepository.findByIds)
    .mockResolvedValue(fix(10.75, 106.75));
  await expect(assertNearTowDestination(ticket()))
    .rejects.toMatchObject({statusCode: 400});
});

test("skips the guard without a fresh fix", async () => {
  jest.mocked(providerLocationRepository.findByIds)
    .mockResolvedValue(new Map());
  await expect(assertNearTowDestination(ticket())).resolves.toBeUndefined();
});

test("checks free-form destination points", async () => {
  jest.mocked(providerRepository.findById).mockResolvedValue(null as never);
  jest.mocked(providerLocationRepository.findByIds)
    .mockResolvedValue(fix(10.75, 106.75));
  await expect(assertNearTowDestination(ticket({
    destinationShopId: null,
    destinationPoint: {lat: 10.7, lng: 106.7},
  }))).rejects.toMatchObject({statusCode: 400});
});
