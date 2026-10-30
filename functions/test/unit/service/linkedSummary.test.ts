import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import {linkedSummaryFor} from "../../../service/dispatch/summary";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../service/dispatch/candidates", () => ({
  findTowOperators: jest.fn(async () => []),
}));

const oldSos = {
  id: "old",
  ticketType: "SOS",
  status: "15",
  userId: "rider1",
  sosAttempt: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  unfixable: {
    reason: "SAFETY",
    photoUrls: ["dispatch/old/a.jpg"],
    by: "op1",
    at: "2026-01-01T00:05:00.000Z",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(providerRepository.findById).mockResolvedValue(null);
  jest.mocked(dispatchRepository.findById).mockImplementation(async (id) => {
    if (id === "old") return oldSos as never;
    if (id === "new") {
      return {
        id: "new",
        ticketType: "SOS",
        continuedFromTicketId: "old",
      } as never;
    }
    if (id === "walk") return {id: "walk", ticketType: "WALK_IN"} as never;
    return null;
  });
});

describe("linkedSummaryFor", () => {
  test("does not treat a child continuation as a previous SOS", async () => {
    await expect(linkedSummaryFor({
      id: "old",
      ticketType: "SOS",
      linkedTicketIds: ["new"],
    } as never)).resolves.toBeNull();
  });

  test("returns the parent SOS for a continuation", async () => {
    await expect(linkedSummaryFor({
      id: "new",
      ticketType: "SOS",
      continuedFromTicketId: "old",
    } as never)).resolves.toMatchObject({
      ticketId: "old",
      unfixableReason: "SAFETY",
      evidencePhotoUrls: ["dispatch/old/a.jpg"],
    });
  });

  test("returns the source SOS for a TOW", async () => {
    await expect(linkedSummaryFor({
      id: "tow",
      ticketType: "TOW",
      sourceTicketId: "old",
    } as never)).resolves.toMatchObject({
      ticketId: "old",
      unfixableReason: "SAFETY",
    });
  });

  test("finds a legacy linked SOS for a TOW", async () => {
    await expect(linkedSummaryFor({
      id: "tow",
      ticketType: "TOW",
      linkedTicketIds: ["walk", "old"],
    } as never)).resolves.toMatchObject({
      ticketId: "old",
      unfixableReason: "SAFETY",
    });
  });
});
