import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  seedFlag,
  db,
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
    expect(hit.body.data).toMatchObject({
      cached: true,
      source: "cache",
      distanceMeters: 2450,
      durationSeconds: 512,
    });
    expect(hit.body.data.geometry).toEqual(geometry);
  });

  it("POST /routes 409s on a flooded cached route", async () => {
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.76,
      lng: 106.66,
      radiusMeters: 300,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send(body);
    expect(res.status).toBe(409);
    expect(res.body.errors[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes detours around a fresh blockage", async () => {
    const direct = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    const around = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.69, 10.79],
        [106.7, 10.78],
      ],
    };
    jest.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 2450, duration: 512, geometry: direct}],
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{distance: 2600, duration: 560, geometry: around}],
        }),
      } as unknown as Response);
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.795, destLng: 106.71});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      cached: false,
      source: "detour",
      distanceMeters: 2600,
    });
    expect(res.body.data.via).toMatchObject({
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
    expect(res.body.data.hazards[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes unblocks after the flood is gone", async () => {
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({cached: true, source: "cache"});
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
