import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import {db} from "../../../config/firebase";
import {
  ACTIVE_TICKET_STATUSES,
  claimForAssignment,
  findBusyUids,
  findByStatusForTypes,
  findPendingForShop,
  findRecentForShop,
  findStaleWalkIns,
} from "../../../repository/dispatchRepository";

jest.mock("../../../config/firebase", () => ({
  db: {
    collection: jest.fn(),
    getAll: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
  auth: {updateUser: jest.fn()},
  FieldValue: {arrayUnion: (...values: unknown[]) => ({__union: values})},
}));

type Snap = {exists: boolean; id: string; data: () => unknown};

const snap = (
  id: string,
  data: unknown,
  exists = true,
): Snap => ({
  exists,
  id,
  data: () => data,
});

const whereCalls: unknown[][] = [];
let pages: Snap[][] = [];

const installCollection = () => {
  const get = jest.fn(async () => ({
    forEach: (fn: (d: Snap) => void) => {
      (pages.shift() ?? []).forEach(fn);
    },
  }));
  const chainable: {
    where: (...args: unknown[]) => unknown;
    limit: (...args: unknown[]) => unknown;
    get: unknown;
  } = {
    where: (...args: unknown[]) => {
      whereCalls.push(args);
      return chainable;
    },
    limit: (...args: unknown[]) => {
      whereCalls.push(["limit", ...args]);
      return chainable;
    },
    get,
  };
  jest.mocked(db.collection).mockReturnValue(
    {doc: jest.fn(), ...chainable} as never,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  whereCalls.length = 0;
  pages = [];
  installCollection();
});

describe("dispatchRepository.findBusyUids", () => {
  test("returns an empty set without touching the database", async () => {
    await expect(findBusyUids([])).resolves.toEqual(new Set());
    expect(db.collection).not.toHaveBeenCalled();
  });

  test("collects uids holding active tickets", async () => {
    pages = [[
      snap("t1", {assignedUid: "vol1", status: "2"}),
      snap("t2", {assignedUid: "vol2", status: "3"}),
      snap("t3", {assignedUid: "vol3", status: "4"}),
      snap("t4", {status: "2"}),
    ]];
    await expect(
      findBusyUids(["vol1", "vol2", "vol3", "vol4"]),
    ).resolves.toEqual(new Set(["vol1", "vol2"]));
    expect(whereCalls[0]?.slice(0, 2)).toEqual(["assignedUid", "in"]);
  });

  test("chunks large uid lists at thirty", async () => {
    pages = [[], []];
    const uids = Array.from({length: 31}, (_, i) => `u${i}`);
    await findBusyUids(uids);
    expect(whereCalls).toHaveLength(2);
    expect((whereCalls[0]?.[2] as string[]).length).toBe(30);
    expect((whereCalls[1]?.[2] as string[]).length).toBe(1);
  });

  test("active statuses are matched and arrived only", async () => {
    expect(ACTIVE_TICKET_STATUSES.has("2")).toBe(true);
    expect(ACTIVE_TICKET_STATUSES.has("3")).toBe(true);
    expect(ACTIVE_TICKET_STATUSES.has("1")).toBe(false);
    expect(ACTIVE_TICKET_STATUSES.has("4")).toBe(false);
    expect(ACTIVE_TICKET_STATUSES.has("5")).toBe(false);
  });
});

describe("dispatchRepository.claimForAssignment", () => {
  const runTx = (data: unknown, exists = true) => {
    const updates: Array<{ref: unknown; patch: unknown}> = [];
    jest.mocked(db.runTransaction).mockImplementation(
      (async (fn: unknown) => {
        const tx = {
          get: async () => ({exists, data: () => data}),
          update: (ref: unknown, patch: unknown) => {
            updates.push({ref, patch});
          },
        };
        await (fn as (t: unknown) => Promise<void>)(tx);
      }) as never,
    );
    return updates;
  };

  test("claims a pending ticket and clears candidates", async () => {
    const updates = runTx({status: "1"});
    const claimed = await claimForAssignment("t1", {
      assignedUid: "vol1",
      status: "2",
    });
    expect(claimed).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch).toEqual({
      assignedUid: "vol1",
      status: "2",
      candidates: [],
    });
  });

  test("records the claimer in history", async () => {
    const updates = runTx({status: "1"});
    const claimed = await claimForAssignment(
      "t1",
      {assignedUid: "vol1", status: "2"},
      "vol1",
    );
    expect(claimed).toBe(true);
    const patch = updates[0]?.patch as {statusHistory?: unknown};
    expect(patch.statusHistory).toEqual({
      __union: [{status: "2", at: expect.any(String), by: "vol1"}],
    });
  });

  test("refuses a ticket that is no longer pending", async () => {
    const updates = runTx({status: "2"});
    await expect(
      claimForAssignment("t1", {assignedUid: "vol1", status: "2"}),
    ).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });

  test("refuses a missing ticket", async () => {
    runTx({}, false);
    await expect(
      claimForAssignment("t1", {assignedUid: "vol1", status: "2"}),
    ).resolves.toBe(false);
  });
});

describe("dispatchRepository shop lists", () => {
  test("findPendingForShop returns newest pending first", async () => {
    pages = [[
      snap("t1", {status: "1", createdAt: "2026-01-01"}),
      snap("t2", {status: "2", createdAt: "2026-01-03"}),
      snap("t3", {status: "1", createdAt: "2026-01-02"}),
    ]];
    const result = await findPendingForShop("shop9");
    expect(result.map((t) => t.id)).toEqual(["t3", "t1"]);
    expect(whereCalls[0]?.slice(0, 2)).toEqual(["providerId", "=="]);
  });
  test("findRecentForShop caps newest first", async () => {
    pages = [[
      snap("t1", {status: "4", createdAt: "2026-01-01"}),
      snap("t2", {status: "4", createdAt: "2026-01-03"}),
      snap("t3", {status: "2", createdAt: "2026-01-02"}),
    ]];
    const result = await findRecentForShop("shop9", 2);
    expect(result.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(whereCalls[0]?.slice(0, 2)).toEqual(["assignedShopId", "=="]);
  });
});

describe("dispatchRepository typed status lists", () => {
  test("findByStatusForTypes queries each type", async () => {
    pages = [[snap("t1", {status: "1"})], []];
    const result = await findByStatusForTypes("1", ["SOS", "TOW"], 200);
    expect(result.map((t) => t.id)).toEqual(["t1"]);
    expect(whereCalls).toContainEqual(["status", "==", "1"]);
    expect(whereCalls).toContainEqual(["ticketType", "==", "SOS"]);
    expect(whereCalls).toContainEqual(["ticketType", "==", "TOW"]);
  });
  test("findStaleWalkIns keeps fresh and non-pending tickets", async () => {
    pages = [[
      snap("old", {status: "1", ticketType: "WALK_IN",
        expiresAt: "2026-01-01T00:00:00.000Z"}),
      snap("fresh", {status: "1", ticketType: "WALK_IN",
        expiresAt: "2999-01-01T00:00:00.000Z"}),
      snap("done", {status: "4", ticketType: "WALK_IN",
        expiresAt: "2026-01-01T00:00:00.000Z"}),
    ]];
    const result = await findStaleWalkIns("2026-06-01T00:00:00.000Z");
    expect(result.map((t) => t.id)).toEqual(["old"]);
    expect(whereCalls[0]?.slice(0, 2)).toEqual(["ticketType", "=="]);
  });
});
