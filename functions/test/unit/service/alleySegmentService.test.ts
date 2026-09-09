import * as alleySegmentRepository from
  "../../../repository/alleySegmentRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  getSegment,
  createSegment,
  setPassability,
  moderateSegment,
  computePassability,
} from "../../../service/alleySegmentService";

jest.mock("../../../repository/alleySegmentRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("computePassability", () => {
  it("scores unknown width as neutral", () => {
    expect(computePassability({id: "s", tier: "T1"}, 0.7)).toEqual({
      compatible: true,
      score: 50,
      reason: "UNKNOWN_WIDTH",
    });
    expect(
      computePassability({id: "s", tier: "T1", baseWidth: 0}, 0.7),
    ).toEqual({
      compatible: true,
      score: 50,
      reason: "UNKNOWN_WIDTH",
    });
  });

  it("rejects vehicles wider than the segment", () => {
    expect(
      computePassability({id: "s", tier: "T1", baseWidth: 0.8}, 1.0),
    ).toEqual({
      compatible: false,
      score: 10,
      reason: "NARROWER_THAN_VEHICLE",
    });
  });

  it("grades by margin", () => {
    expect(
      computePassability({id: "s", tier: "T1", baseWidth: 1.2}, 0.7),
    ).toMatchObject({compatible: true, score: 90, reason: "WIDE"});
    expect(
      computePassability({id: "s", tier: "T1", baseWidth: 0.9}, 0.7),
    ).toMatchObject({compatible: true, score: 70, reason: "TIGHT"});
    expect(
      computePassability({id: "s", tier: "T1", baseWidth: 0.75}, 0.7),
    ).toMatchObject({compatible: true, score: 50, reason: "VERY_TIGHT"});
  });
});

describe("alleySegmentService.getSegment", () => {
  it("throws 404 for an unknown segment", async () => {
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue(null);
    await expect(getSegment("ghost")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("alleySegmentService.createSegment", () => {
  it("throws 404 for an unknown user", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      createSegment({userId: "ghost", lat: 1, lng: 2, tier: "TIER1"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("creates the segment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    const segment = {id: "s1"};
    jest.mocked(alleySegmentRepository.create).mockResolvedValue(
      segment as never,
    );
    await expect(
      createSegment({userId: "u1", lat: 1, lng: 2, tier: "TIER1"}),
    ).resolves.toBe(segment);
  });
});

describe("alleySegmentService.setPassability", () => {
  it("throws 404 for unknown user or segment", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(
      setPassability({userId: "ghost", segmentId: "s1", tier: "TIER1"}),
    ).rejects.toMatchObject({statusCode: 404});
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue(null);
    await expect(
      setPassability({userId: "u1", segmentId: "ghost", tier: "TIER1"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("writes the measurements", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue({
      id: "s1",
    } as never);
    jest.mocked(alleySegmentRepository.update).mockResolvedValue(undefined);
    await expect(
      setPassability({
        userId: "u1",
        segmentId: "s1",
        baseWidth: 1.1,
        tier: "TIER2",
      }),
    ).resolves.toEqual({updated: 1});
    expect(alleySegmentRepository.update).toHaveBeenCalledWith("s1", {
      baseWidth: 1.1,
      tier: "TIER2",
    });
  });
});

describe("alleySegmentService.moderateSegment", () => {
  it("throws 404 for an unknown segment", async () => {
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue(null);
    await expect(moderateSegment({segmentId: "ghost"})).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("patches only provided fields", async () => {
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue({
      id: "s1",
    } as never);
    jest.mocked(alleySegmentRepository.update).mockResolvedValue(undefined);
    await expect(
      moderateSegment({segmentId: "s1", tier: "TIER1"}),
    ).resolves.toEqual({updated: 1});
    expect(alleySegmentRepository.update).toHaveBeenCalledWith("s1", {
      tier: "TIER1",
    });
  });

  it("skips the write when the patch is empty", async () => {
    jest.mocked(alleySegmentRepository.findById).mockResolvedValue({
      id: "s1",
    } as never);
    await expect(moderateSegment({segmentId: "s1"})).resolves.toEqual({
      updated: 1,
    });
    expect(alleySegmentRepository.update).not.toHaveBeenCalled();
  });
});
