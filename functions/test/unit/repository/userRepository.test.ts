import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {db} from "../../../config/firebase";
import {findByIds} from "../../../repository/userRepository";

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

describe("userRepository.findByIds", () => {
  test("returns empty Map with no db calls", async () => {
    jest.mocked(db.collection).mockReturnValue({
      doc: jest.fn(),
    } as never);
    jest.mocked(db.getAll).mockResolvedValue([] as never);
    const result = await findByIds([]);
    expect(result.size).toBe(0);
    expect(jest.mocked(db.collection)).not.toHaveBeenCalled();
    expect(jest.mocked(db.getAll)).not.toHaveBeenCalled();
  });

  test("batches 31 ids into two getAll calls", async () => {
    const ids = Array.from({length: 31}, (_, i) => `u${i}`);
    const docMock = jest.fn((id: string) => ({id}));
    jest.mocked(db.collection).mockReturnValue({
      doc: docMock,
    } as never);
    jest.mocked(db.getAll).mockImplementation(
      async (...refs: unknown[]) =>
        refs.map((ref) => ({
          exists: true,
          id: (ref as {id: string}).id,
          data: () => ({role: "2"}),
        })) as never,
    );
    const result = await findByIds(ids);
    expect(result.size).toBe(31);
    expect(jest.mocked(db.getAll)).toHaveBeenCalledTimes(2);
    expect(
      jest.mocked(db.getAll).mock.calls[0].length,
    ).toBe(30);
    expect(
      jest.mocked(db.getAll).mock.calls[1].length,
    ).toBe(1);
  });

  test("skips missing docs", async () => {
    jest.mocked(db.collection).mockReturnValue({
      doc: jest.fn((id: string) => ({id})),
    } as never);
    jest.mocked(db.getAll).mockResolvedValue([
      {exists: true, id: "u1", data: () => ({role: "2"})},
      {exists: false, id: "u2", data: () => ({})},
    ] as never);
    const result = await findByIds(["u1", "u2"]);
    expect(result.has("u1")).toBe(true);
    expect(result.has("u2")).toBe(false);
    expect(result.get("u1")).toEqual({id: "u1", role: "2"});
  });
});
