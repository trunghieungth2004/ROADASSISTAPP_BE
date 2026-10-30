import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import {continueSos} from "../../../service/dispatch/sos";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository", () => ({
  findById: jest.fn(async () => ({id: "rider1", role: "2"})),
}));
jest.mock("../../../service/dispatch/tickets", () => ({
  createDispatch: jest.fn(),
}));
jest.mock("../../../service/dispatch/candidates", () => ({
  findCandidates: jest.fn(async () => []),
}));
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));
jest.mock("../../../config/firebase", () => ({
  db: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(providerRepository.findById).mockResolvedValue(null);
});

describe("continueSos soft cap", () => {
  test("attempt 2 requires explicit confirmation", async () => {
    jest.mocked(dispatchRepository.findById).mockImplementation(async (id) => {
      if (id === "sos2") {
        return {
          id: "sos2",
          userId: "rider1",
          ticketType: "SOS",
          status: "15",
          lat: 10.7,
          lng: 106.6,
          sosAttempt: 2,
          continuedFromTicketId: "sos1",
          mobileCallOutFee: 50000,
          excludedShopIds: [],
          excludedOperatorUids: [],
        } as never;
      }
      if (id === "sos1") {
        return {
          id: "sos1",
          userId: "rider1",
          ticketType: "SOS",
          status: "15",
          lat: 10.7,
          lng: 106.6,
          sosAttempt: 1,
          mobileCallOutFee: 50000,
        } as never;
      }
      return null;
    });

    await expect(continueSos({
      userId: "rider1",
      ticketId: "sos2",
      auto: true,
    })).resolves.toMatchObject({
      requiresContinuationConfirmation: true,
      nextAttempt: 3,
      callOutTotal: 100000,
    });
  });

  test("refuses while a tow offer is pending", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "sos1",
      userId: "rider1",
      ticketType: "SOS",
      status: "15",
      lat: 10.7,
      lng: 106.6,
      sosAttempt: 1,
      mobileCallOutFee: 50000,
      mobileTowOffer: {status: "PENDING"},
    } as never);

    await expect(continueSos({
      userId: "rider1",
      ticketId: "sos1",
      auto: true,
    })).rejects.toMatchObject({statusCode: 400});
  });
});
