import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as providerLocationRepository from
  "../../../repository/providerLocationRepository";
import * as userRepository from "../../../repository/userRepository";
import {acceptAsShop} from "../../../service/dispatch/accept";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/providerLocationRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const shop = {
  id: "mobile1",
  kind: "MOBILE_SHOP",
  operatorUid: "op1",
  status: "ACTIVE",
  accepting: true,
  vehicleType: "CAR",
};

const ticket = {
  id: "sos1",
  userId: "rider1",
  ticketType: "SOS",
  status: "1",
  lat: 10.7,
  lng: 106.6,
  vehicleType: "CAR",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
  jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(true);
  jest.mocked(dispatchRepository.findActiveForShop).mockResolvedValue([]);
  jest.mocked(providerRepository.findById).mockResolvedValue(shop as never);
  jest.mocked(providerRepository.findByOperator)
    .mockResolvedValue([shop] as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
});

function fixAt(lat: number, lng: number) {
  jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
    new Map([["mobile1", {
      providerId: "mobile1",
      lat,
      lng,
      lastSeen: new Date().toISOString(),
    }]]) as never,
  );
}

describe("SOS mobile call-out waiver", () => {
  test("waives the call-out within 1 km", async () => {
    fixAt(10.7, 106.605);
    await acceptAsShop("op1", "sos1", "mobile1");
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        mobileCallOutFee: 0,
        mobileCallOutWaived: true,
      }),
      "op1",
    );
  });

  test("charges the call-out beyond 1 km", async () => {
    fixAt(10.7, 106.62);
    await acceptAsShop("op1", "sos1", "mobile1");
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        mobileCallOutFee: 50000,
        mobileCallOutWaived: false,
      }),
      "op1",
    );
  });

  test("charges the call-out when the location is stale", async () => {
    jest.mocked(providerLocationRepository.findByIds).mockResolvedValue(
      new Map([["mobile1", {
        providerId: "mobile1",
        lat: 10.7,
        lng: 106.6,
        lastSeen: "2020-01-01T00:00:00.000Z",
      }]]) as never,
    );
    await acceptAsShop("op1", "sos1", "mobile1");
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        mobileCallOutFee: 50000,
        mobileCallOutWaived: false,
      }),
      "op1",
    );
  });
});
