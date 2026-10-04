import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {db} from "../../../config/firebase";
import {registerToken} from "../../../repository/fcmTokenRepository";

jest.mock("../../../config/firebase", () => ({
  db: {
    collection: jest.fn(),
    getAll: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
  auth: {updateUser: jest.fn()},
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const setupTx = (snapshot: unknown) => {
  const txGet = jest.fn(async (...args: Array<unknown>) => {
    void args;
    return snapshot as never;
  });
  const txSet = jest.fn((...args: Array<unknown>) => {
    void args;
  });
  const fakeTx = {get: txGet, set: txSet};
  const ref = {id: "u1"};
  const docMock = jest.fn(() => ref);
  jest.mocked(db.collection).mockReturnValue({
    doc: docMock,
  } as never);
  jest.mocked(db.runTransaction).mockImplementation(
    (async (fn: never) =>
      (fn as unknown as (tx: unknown) => Promise<unknown>)(
        fakeTx,
      )) as never,
  );
  return {txGet, txSet, docMock, ref};
};

describe("fcmTokenRepository.registerToken", () => {
  test("stores single token for new user", async () => {
    const {txSet} = setupTx({
      exists: false,
      data: () => ({}),
    });
    const result = await registerToken("u1", "t1");
    expect(result.userId).toBe("u1");
    expect(result.tokens).toEqual(["t1"]);
    expect(typeof result.updatedAt).toBe("string");
    expect(jest.mocked(db.runTransaction)).toHaveBeenCalledTimes(
      1,
    );
    expect(txSet).toHaveBeenCalledTimes(1);
    expect(txSet.mock.calls[0][1]).toMatchObject({
      userId: "u1",
      tokens: ["t1"],
    });
  });

  test("moves existing token to front", async () => {
    const {txSet} = setupTx({
      exists: true,
      data: () => ({tokens: ["a", "b", "c"]}),
    });
    const result = await registerToken("u1", "c");
    expect(result.tokens).toEqual(["c", "a", "b"]);
    expect(txSet).toHaveBeenCalledTimes(1);
    expect(txSet.mock.calls[0][1]).toMatchObject({
      tokens: ["c", "a", "b"],
    });
  });

  test("caps list at five evicting oldest", async () => {
    const {txSet} = setupTx({
      exists: true,
      data: () => ({tokens: ["t1", "t2", "t3", "t4", "t5"]}),
    });
    const result = await registerToken("u1", "t6");
    expect(result.tokens).toEqual(["t6", "t1", "t2", "t3", "t4"]);
    expect(result.tokens).toHaveLength(5);
    expect(txSet.mock.calls[0][1]).toMatchObject({
      tokens: ["t6", "t1", "t2", "t3", "t4"],
    });
  });

  test("writes through the transaction", async () => {
    const {txGet, txSet, docMock} = setupTx({
      exists: false,
      data: () => ({}),
    });
    await registerToken("u1", "t1");
    expect(jest.mocked(db.collection)).toHaveBeenCalledWith(
      "fcm_tokens",
    );
    expect(docMock).toHaveBeenCalledWith("u1");
    expect(txGet).toHaveBeenCalledTimes(1);
    expect(txSet).toHaveBeenCalledTimes(1);
    expect(jest.mocked(db.runTransaction)).toHaveBeenCalledTimes(
      1,
    );
  });
});
