import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as chatRepository from "../../../repository/chatRepository";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {chatService} from "../../../service/chatService";

jest.mock("../../../repository/chatRepository");
jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/flagRepository");
jest.mock("../../../repository/fcmTokenRepository");
jest.mock("../../../config/firebase", () => ({
  messaging: {sendEach: jest.fn()},
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(chatRepository.roomIdFor).mockImplementation(
    (scope, refId, version = 0) =>
      `${scope.toLowerCase()}_${refId}${version > 0 ? `_v${version}` : ""}`,
  );
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    ticketType: "SOS",
    status: "15",
    assignedShopId: "shop1",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop1",
    operatorUid: "op1",
  } as never);
});

describe("chatService ticket rooms", () => {
  test("creates a terminal ticket room without an expiry", async () => {
    jest.mocked(chatRepository.findById).mockResolvedValue(null);
    jest.mocked(chatRepository.create).mockResolvedValue({
      id: "ticket_t1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
      participantUids: ["rider1", "op1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      closedAt: null,
    });

    await expect(chatService.open({
      userId: "rider1",
      scope: "TICKET",
      refId: "t1",
    })).resolves.toMatchObject({expiresAt: null});
    expect(chatRepository.create).toHaveBeenCalledWith(
      "TICKET",
      "t1",
      ["rider1", "op1"],
      null,
      0,
    );
  });

  test("clears an old expiry on an existing ticket room", async () => {
    jest.mocked(chatRepository.findById).mockResolvedValue({
      id: "ticket_t1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
      participantUids: ["rider1", "op1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      closedAt: null,
    });

    await expect(chatService.open({
      userId: "rider1",
      scope: "TICKET",
      refId: "t1",
    })).resolves.toMatchObject({expiresAt: null});
    expect(chatRepository.clearExpiry).toHaveBeenCalledWith("ticket_t1");
  });

  test("rejects a different shop on the ticket", async () => {
    await expect(chatService.open({
      userId: "op2",
      scope: "TICKET",
      refId: "t1",
    })).rejects.toMatchObject({statusCode: 403});
  });

  test("opens an archived room read-only", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "TOW",
      status: "2",
      assignedShopId: "shop2",
      chatVersion: 1,
    } as never);
    jest.mocked(chatRepository.findById).mockResolvedValue({
      id: "ticket_t1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
      participantUids: ["rider1", "op1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      closedAt: "2026-01-01T00:10:00.000Z",
    });
    await expect(chatService.open({
      userId: "op1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
    })).resolves.toMatchObject({
      id: "ticket_t1",
      version: 0,
      closedAt: "2026-01-01T00:10:00.000Z",
    });
  });

  test("refuses to send into an archived room", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      ticketType: "TOW",
      status: "2",
      assignedShopId: "shop2",
      chatVersion: 1,
    } as never);
    jest.mocked(chatRepository.findById).mockResolvedValue({
      id: "ticket_t1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
      participantUids: ["rider1", "op1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      closedAt: "2026-01-01T00:10:00.000Z",
    });
    await expect(chatService.send({
      userId: "rider1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
      text: "hello",
    })).rejects.toMatchObject({statusCode: 400});
  });

  test("keeps terminal ticket chat read-only", async () => {
    jest.mocked(chatRepository.findById).mockResolvedValue({
      id: "ticket_t1",
      scope: "TICKET",
      refId: "t1",
      version: 0,
      participantUids: ["rider1", "op1"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      closedAt: null,
    });
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      displayName: "Rider",
    } as never);

    await expect(chatService.send({
      userId: "rider1",
      scope: "TICKET",
      refId: "t1",
      text: "hello",
    })).rejects.toMatchObject({statusCode: 400});
  });
});
