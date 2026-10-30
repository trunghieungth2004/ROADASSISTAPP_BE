import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {markUnfixable} from "../../../service/dispatch/shop";
import {continueSos} from "../../../service/dispatch/sos";
import {mobileTowAvailabilityFor} from "../../../service/dispatch/summary";
import {enqueueDispatchPush} from "../../../service/taskQueueService";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../service/dispatch/waiting", () => ({
  startWaiting: jest.fn(async () => undefined),
  stopWaiting: jest.fn(async () => undefined),
}));
jest.mock("../../../service/dispatch/sos", () => ({
  continueSos: jest.fn(async () => ({ticketId: "sos2"})),
}));
jest.mock("../../../service/dispatch/summary", () => ({
  linkedSummaryFor: jest.fn(async () => null),
  mobileTowAvailabilityFor: jest.fn(async () => ({
    available: false,
    mode: "NETWORK",
    state: "NONE_NEARBY",
    towProviderId: null,
  })),
  sosCallOutTotalFor: jest.fn(async () => 0),
}));
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const ticket = {
  id: "t1",
  userId: "rider1",
  ticketType: "SOS",
  status: "3",
  assignedShopId: "mobile1",
  lat: 10.7,
  lng: 106.6,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.findById).mockResolvedValue(ticket as never);
  jest.mocked(dispatchRepository.update).mockResolvedValue(undefined);
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "mobile1",
    kind: "MOBILE_SHOP",
    operatorUid: "op1",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(continueSos).mockResolvedValue({ticketId: "sos2"} as never);
  jest.mocked(mobileTowAvailabilityFor).mockResolvedValue({
    available: false,
    mode: "NETWORK",
    state: "NONE_NEARBY",
    towProviderId: null,
  });
});

describe("markUnfixable continuation", () => {
  test("auto-continues when no eligible tow exists", async () => {
    await expect(markUnfixable({
      userId: "op1",
      ticketId: "t1",
      reason: "SAFETY",
      photoUrls: ["dispatch/t1/a.jpg"],
    })).resolves.toMatchObject({
      unfixable: true,
      continuationTicketId: "sos2",
    });
    expect(continueSos).toHaveBeenCalledWith({
      userId: "rider1",
      ticketId: "t1",
      auto: true,
    });
  });

  test("schedules the grace task when a tow is available", async () => {
    jest.mocked(mobileTowAvailabilityFor).mockResolvedValue({
      available: true,
      mode: "DIRECT",
      state: "DIRECT",
      towProviderId: "tow1",
    });
    await expect(markUnfixable({
      userId: "op1",
      ticketId: "t1",
      reason: "SAFETY",
      photoUrls: ["dispatch/t1/a.jpg"],
    })).resolves.toEqual({unfixable: true});
    expect(continueSos).not.toHaveBeenCalled();
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("-unfix-grace-"),
      expect.objectContaining({action: "unfix-grace"}),
      expect.any(String),
    );
  });
});
