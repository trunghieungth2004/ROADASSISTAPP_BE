import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;

const geometry = {type: "LineString", coordinates: [[106.66, 10.76]]};

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
});

afterAll(async () => {
  await cleanAll();
  jest.restoreAllMocks();
});

describe("routing endpoints", () => {
  const body = {
    originLat: BASE_LAT,
    originLng: BASE_LNG,
    destLat: 10.7758,
    destLng: 106.7019,
  };

  beforeEach(() => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{distance: 2450, duration: 512, geometry}],
      }),
    } as unknown as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POST /routes misses then serves from cache", async () => {
    const miss = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send(body);
    expect(miss.status).toBe(200);
    expect(miss.body.data).toMatchObject({
      cached: false,
      source: "osrm",
      distanceMeters: 2450,
    });
    const hit = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send(body);
    expect(hit.status).toBe(200);
    expect(hit.body.data).toMatchObject({cached: true, source: "cache"});
    expect(hit.body.data.geometry).toEqual(geometry);
  });

  it("POST /routes returns 500 when OSRM is down", async () => {
    jest.restoreAllMocks();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.79});
    expect(res.status).toBe(500);
  });
});
