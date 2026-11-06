import * as landmarkRepository from
  "../../../repository/landmarkRepository";
import * as userRepository from "../../../repository/userRepository";
import {createLandmark} from "../../../service/landmarkService";

jest.mock("../../../repository/landmarkRepository");
jest.mock("../../../repository/userRepository");

beforeEach(() => {
  jest.clearAllMocks();
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
