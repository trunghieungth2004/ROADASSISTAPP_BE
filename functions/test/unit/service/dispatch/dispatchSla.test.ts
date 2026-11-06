import * as dispatchRepository from
  "../../../../repository/dispatchRepository";
import {findCandidates, findTowOperators} from
  "../../../../service/dispatch/candidates";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";
import {sweepDispatchSla} from "../../../../service/dispatch/sla";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../service/dispatch/candidates", () => ({
  findCandidates: jest.fn(async () => []),
  findTowOperators: jest.fn(async () => []),
}));
jest.mock("../../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const ticket = (overrides: Record<string, unknown> = {}): never => ({
  id: "t1",
  userId: "u1",
  ticketType: "TOW",
  status: "1",
  lat: 10.7,
  lng: 106.6,
  dispatchRound: 1,
  dispatchRadiusMeters: 10000,
  notifiedOperatorUids: ["op1"],
  ...overrides,
}) as never;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.update).mockResolvedValue(undefined as never);
});

describe("sweepDispatchSla", () => {
  it("rebroadcasts to a fresh cohort and grows the radius", async () => {
    jest.mocked(dispatchRepository.findDueForSla)
      .mockResolvedValue([ticket()]);
    jest.mocked(findTowOperators).mockResolvedValue(
      ["op1", "op2"] as never,
    );
    await expect(sweepDispatchSla()).resolves.toEqual({
      rebroadcast: 1,
      breached: 0,
    });
    expect(findTowOperators).toHaveBeenCalledWith(
      expect.objectContaining({radiusMeters: 15000}),
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        candidates: ["op2"],
        notifiedOperatorUids: ["op1", "op2"],
        dispatchRound: 2,
        dispatchRadiusMeters: 15000,
      }),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith("t1", "-sla-2");
  });

  it("passes notified operators as exclusions for SOS", async () => {
    jest.mocked(dispatchRepository.findDueForSla).mockResolvedValue([
      ticket({
        ticketType: "SOS",
        dispatchRadiusMeters: 5000,
        symptom: "BATTERY",
      }),
    ]);
    jest.mocked(findCandidates).mockResolvedValue(["op3"] as never);
    await sweepDispatchSla();
    expect(findCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        radiusMeters: 7500,
        excludeOperatorUids: ["op1"],
        serviceCategory: "BATTERY",
      }),
    );
  });

  it("caps the radius at the platform maximum", async () => {
    jest.mocked(dispatchRepository.findDueForSla).mockResolvedValue([
      ticket({dispatchRadiusMeters: 25000}),
    ]);
    jest.mocked(findTowOperators).mockResolvedValue(["op2"] as never);
    await sweepDispatchSla();
    expect(findTowOperators).toHaveBeenCalledWith(
      expect.objectContaining({radiusMeters: 30000}),
    );
  });

  it("marks a breach after the last round", async () => {
    jest.mocked(dispatchRepository.findDueForSla)
      .mockResolvedValue([ticket({dispatchRound: 3})]);
    await expect(sweepDispatchSla()).resolves.toEqual({
      rebroadcast: 0,
      breached: 1,
    });
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({slaBreachedAt: expect.any(String)}),
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      "-sla-breach",
      expect.objectContaining({audience: "rider"}),
    );
  });

  it("marks a breach when no fresh candidate exists", async () => {
    jest.mocked(dispatchRepository.findDueForSla)
      .mockResolvedValue([ticket()]);
    jest.mocked(findTowOperators).mockResolvedValue(["op1"] as never);
    await expect(sweepDispatchSla()).resolves.toEqual({
      rebroadcast: 0,
      breached: 1,
    });
  });

  it("does not breach twice", async () => {
    jest.mocked(dispatchRepository.findDueForSla).mockResolvedValue([
      ticket({dispatchRound: 3, slaBreachedAt: "2026-01-01T00:00:00Z"}),
    ]);
    await expect(sweepDispatchSla()).resolves.toEqual({
      rebroadcast: 0,
      breached: 0,
    });
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  it("ignores addressed tows", async () => {
    jest.mocked(dispatchRepository.findDueForSla).mockResolvedValue([
      ticket({ticketType: "TOW", addressedTow: true}),
    ]);
    await sweepDispatchSla();
    expect(findTowOperators).not.toHaveBeenCalled();
  });

  it("ignores named-shop tickets", async () => {
    jest.mocked(dispatchRepository.findDueForSla).mockResolvedValue([
      ticket({ticketType: "WALK_IN"}),
    ]);
    await sweepDispatchSla();
    expect(findCandidates).not.toHaveBeenCalled();
  });
});
