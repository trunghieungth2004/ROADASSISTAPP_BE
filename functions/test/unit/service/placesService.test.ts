import * as shopRepository from "../../../repository/shopRepository";
import * as landmarkRepository from "../../../repository/landmarkRepository";
import {searchDirectory} from "../../../service/placesService";

jest.mock("../../../repository/shopRepository");
jest.mock("../../../repository/landmarkRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("placesService.searchDirectory", () => {
  it("rejects blank queries with 400", async () => {
    await expect(searchDirectory({q: "   "})).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(shopRepository.findByNamePrefix).not.toHaveBeenCalled();
  });

  it("merges shops before landmarks", async () => {
    jest.mocked(shopRepository.findByNamePrefix).mockResolvedValue([
      {id: "s1", name: "Demo Shop", lat: 1, lng: 2, type: "SHOP"} as never,
    ]);
    jest.mocked(landmarkRepository.findByLabelPrefix).mockResolvedValue([
      {id: "l1", displayLabel: "Demo Landmark", lat: 3, lng: 4} as never,
    ]);
    const res = await searchDirectory({q: "demo"});
    expect(res).toEqual([
      {kind: "shop", id: "s1", label: "Demo Shop", lat: 1, lng: 2,
        type: "SHOP"},
      {kind: "landmark", id: "l1", label: "Demo Landmark", lat: 3, lng: 4},
    ]);
    expect(shopRepository.findByNamePrefix).toHaveBeenCalledWith("demo", 5);
  });

  it("returns empty when nothing matches", async () => {
    jest.mocked(shopRepository.findByNamePrefix).mockResolvedValue([]);
    jest.mocked(landmarkRepository.findByLabelPrefix).mockResolvedValue([]);
    await expect(searchDirectory({q: "zzz"})).resolves.toEqual([]);
  });
});
