import * as savedPlaceRepository from
  "../../../repository/savedPlaceRepository";
import {
  listSavedPlaces,
  removeSavedPlace,
  savePlace,
} from "../../../service/savedPlaceService";

jest.mock("../../../repository/savedPlaceRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("savedPlaceService.savePlace", () => {
  it("rejects blank labels with 400", async () => {
    await expect(
      savePlace({userId: "u1", label: "   ", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(savedPlaceRepository.findByCoords).not.toHaveBeenCalled();
  });

  it("updates the label when the coords are already saved", async () => {
    jest.mocked(savedPlaceRepository.findByCoords).mockResolvedValue({
      id: "p1",
      userId: "u1",
      label: "Old",
      lat: 1,
      lng: 2,
      createdAt: "t",
      updatedAt: "t",
    });
    const res = await savePlace({userId: "u1", label: "New", lat: 1, lng: 2});
    expect(res.id).toBe("p1");
    expect(res.label).toBe("New");
    expect(savedPlaceRepository.updateLabel).toHaveBeenCalledWith("p1", "New");
    expect(savedPlaceRepository.create).not.toHaveBeenCalled();
  });

  it("creates when the coords are new", async () => {
    jest.mocked(savedPlaceRepository.findByCoords).mockResolvedValue(null);
    jest.mocked(savedPlaceRepository.countByUserId).mockResolvedValue(3);
    jest.mocked(savedPlaceRepository.create).mockResolvedValue({
      id: "p2",
      userId: "u1",
      label: "Home",
      lat: 1,
      lng: 2,
      createdAt: "t",
      updatedAt: "t",
    });
    const res = await savePlace({userId: "u1", label: "Home", lat: 1, lng: 2});
    expect(res.id).toBe("p2");
    expect(savedPlaceRepository.create).toHaveBeenCalledWith({
      userId: "u1",
      label: "Home",
      lat: 1,
      lng: 2,
    });
  });

  it("rejects above the per-user cap with 400", async () => {
    jest.mocked(savedPlaceRepository.findByCoords).mockResolvedValue(null);
    jest.mocked(savedPlaceRepository.countByUserId).mockResolvedValue(50);
    await expect(
      savePlace({userId: "u1", label: "Too Many", lat: 1, lng: 2}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(savedPlaceRepository.create).not.toHaveBeenCalled();
  });
});

describe("savedPlaceService.listSavedPlaces", () => {
  it("returns the user list", async () => {
    jest.mocked(savedPlaceRepository.listByUserId).mockResolvedValue([
      {
        id: "p1",
        userId: "u1",
        label: "Home",
        lat: 1,
        lng: 2,
        createdAt: "t",
        updatedAt: "t",
      },
    ]);
    await expect(listSavedPlaces("u1")).resolves.toHaveLength(1);
    expect(savedPlaceRepository.listByUserId).toHaveBeenCalledWith("u1");
  });
});

describe("savedPlaceService.removeSavedPlace", () => {
  it("throws 404 for unknown ids", async () => {
    jest.mocked(savedPlaceRepository.findById).mockResolvedValue(null);
    await expect(
      removeSavedPlace({userId: "u1", placeId: "nope"}),
    ).rejects.toMatchObject({statusCode: 404});
  });

  it("throws 403 for other users places", async () => {
    jest.mocked(savedPlaceRepository.findById).mockResolvedValue({
      id: "p1",
      userId: "other",
      label: "X",
      lat: 1,
      lng: 2,
      createdAt: "t",
      updatedAt: "t",
    });
    await expect(
      removeSavedPlace({userId: "u1", placeId: "p1"}),
    ).rejects.toMatchObject({statusCode: 403});
    expect(savedPlaceRepository.deleteById).not.toHaveBeenCalled();
  });

  it("deletes owned places", async () => {
    jest.mocked(savedPlaceRepository.findById).mockResolvedValue({
      id: "p1",
      userId: "u1",
      label: "X",
      lat: 1,
      lng: 2,
      createdAt: "t",
      updatedAt: "t",
    });
    await expect(
      removeSavedPlace({userId: "u1", placeId: "p1"}),
    ).resolves.toEqual({deleted: 1});
    expect(savedPlaceRepository.deleteById).toHaveBeenCalledWith("p1");
  });
});
