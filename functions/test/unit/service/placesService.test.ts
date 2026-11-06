import * as providerRepository from "../../../repository/providerRepository";
import * as landmarkRepository from "../../../repository/landmarkRepository";
import {searchDirectory} from "../../../service/placesService";

jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/landmarkRepository");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("placesService.searchDirectory", () => {
  it("rejects blank queries with 400", async () => {
    await expect(searchDirectory({q: "   "})).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(providerRepository.findByNamePrefix).not.toHaveBeenCalled();
  });

  it("merges shops before landmarks", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "s1", name: "Demo Shop", lat: 1, lng: 2, kind: "SHOP",
        status: "ACTIVE"} as never,
    ]);
    jest.mocked(landmarkRepository.findByLabelPrefix).mockResolvedValue([
      {id: "l1", displayLabel: "Demo Landmark", lat: 3, lng: 4} as never,
    ]);
    const res = await searchDirectory({q: "demo"});
    expect(res).toEqual([
      {kind: "shop", id: "s1", label: "Demo Shop", lat: 1, lng: 2,
        type: "SHOP", providerKind: "SHOP", bookingEnabled: false},
      {kind: "landmark", id: "l1", label: "Demo Landmark", lat: 3, lng: 4},
    ]);
    expect(providerRepository.findByNamePrefix).toHaveBeenCalledWith("demo", 5);
  });

  it("keeps provider kinds distinct and filters by kind", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([
      {id: "s1", name: "Same Name", lat: 1, lng: 2, kind: "SHOP",
        status: "ACTIVE"} as never,
      {id: "t1", name: "Same Name", lat: 1, lng: 2, kind: "TOW",
        status: "ACTIVE"} as never,
      {id: "m1", name: "Same Name", lat: 1, lng: 2, kind: "MOBILE_SHOP",
        status: "ACTIVE"} as never,
    ]);
    jest.mocked(landmarkRepository.findByLabelPrefix).mockResolvedValue([]);
    const all = await searchDirectory({q: "same"});
    expect(all.map((row) => row.providerKind)).toEqual(["SHOP"]);
    const shops = await searchDirectory({q: "same", kind: "SHOP"});
    expect(shops).toHaveLength(1);
    expect(shops[0]).toMatchObject({providerKind: "SHOP"});
    await expect(searchDirectory({q: "same", kind: "TOW"}))
      .resolves.toEqual([]);
  });

  it("returns empty when nothing matches", async () => {
    jest.mocked(providerRepository.findByNamePrefix).mockResolvedValue([]);
    jest.mocked(landmarkRepository.findByLabelPrefix).mockResolvedValue([]);
    await expect(searchDirectory({q: "zzz"})).resolves.toEqual([]);
  });
});
