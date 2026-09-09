import * as landmarkRepository from
  "../../../repository/landmarkRepository";
import * as userRepository from "../../../repository/userRepository";
import {createLandmark, matchNearby} from "../../../service/landmarkService";

jest.mock("../../../repository/landmarkRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

const candidate = (
  id: string,
  embedding: number[] | null,
  lat = 10.7626,
  lng = 106.6602,
) => ({id, embedding, lat, lng});

describe("landmarkService.matchNearby", () => {
  it("accepts the best match above the threshold", async () => {
    jest.mocked(landmarkRepository.findByGeohashPrefixes).mockResolvedValue([
      candidate("weak", [0, 1]),
      candidate("best", [1, 0]),
    ] as never);
    const result = await matchNearby({
      lat: 10.7626,
      lng: 106.6602,
      embedding: [1, 0],
    });
    expect(
      (result.landmark as {id: string} | null)?.id,
    ).toBe("best");
    expect(result.confidence).toBeCloseTo(1, 5);
  });

  it("returns null below the threshold with the best score", async () => {
    jest.mocked(landmarkRepository.findByGeohashPrefixes).mockResolvedValue([
      candidate("far", [0, 1]),
    ] as never);
    const result = await matchNearby({
      lat: 10.7626,
      lng: 106.6602,
      embedding: [1, 0],
    });
    expect(result.landmark).toBeNull();
    expect(result.confidence).toBeCloseTo(0, 5);
  });

  it("skips empty embeddings and mismatched dims", async () => {
    jest.mocked(landmarkRepository.findByGeohashPrefixes).mockResolvedValue([
      candidate("empty", []),
      candidate("none", null),
      candidate("wrong", [1, 0, 0]),
    ] as never);
    const result = await matchNearby({
      lat: 10.7626,
      lng: 106.6602,
      embedding: [1, 0],
    });
    expect(result.landmark).toBeNull();
    expect(result.confidence).toBe(-1);
  });
});

describe("landmarkService.createLandmark", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createLandmark({userId: "ghost", lat: 1, lng: 2, displayLabel: "X"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("creates the landmark", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const landmark = {id: "l1"};
    jest.mocked(landmarkRepository.create).mockResolvedValue(
      landmark as never,
    );
    await expect(
      createLandmark({userId: "u1", lat: 1, lng: 2, displayLabel: "Gate"}),
    ).resolves.toBe(landmark);
    expect(landmarkRepository.create).toHaveBeenCalledWith({
      lat: 1,
      lng: 2,
      displayLabel: "Gate",
      embedding: undefined,
    });
  });
});
