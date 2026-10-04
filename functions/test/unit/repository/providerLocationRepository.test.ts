import {
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {db} from "../../../config/firebase";
import {findByIds} from "../../../repository/providerLocationRepository";

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

describe("providerLocationRepository.findByIds", () => {
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
    const ids = Array.from({length: 31}, (_, i) => `p${i}`);
    const docMock = jest.fn((id: string) => ({id}));
    jest.mocked(db.collection).mockReturnValue({
      doc: docMock,
    } as never);
    jest.mocked(db.getAll).mockImplementation(
      async (...refs: unknown[]) =>
        refs.map((ref) => ({
          exists: true,
          id: (ref as {id: string}).id,
          data: () => ({lat: 1, lng: 2}),
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
      {exists: true, id: "p1", data: () => ({lat: 1})},
      {exists: false, id: "p2", data: () => ({})},
    ] as never);
    const result = await findByIds(["p1", "p2"]);
    expect(result.has("p1")).toBe(true);
    expect(result.has("p2")).toBe(false);
    expect(result.size).toBe(1);
  });

  test("returns entries with providerId plus data", async () => {
    jest.mocked(db.collection).mockReturnValue({
      doc: jest.fn((id: string) => ({id})),
    } as never);
    jest.mocked(db.getAll).mockResolvedValue([
      {
        exists: true,
        id: "p9",
        data: () => ({lat: 10, lng: 20}),
      },
    ] as never);
    const result = await findByIds(["p9"]);
    expect(result.get("p9")).toEqual({
      providerId: "p9",
      lat: 10,
      lng: 20,
    });
  });
});
