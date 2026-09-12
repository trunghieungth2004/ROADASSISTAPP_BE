import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {cellsForBounds, encodeGeohash} from "../../utils/geo";
import {
  cleanAll,
  seedUser,
  seedFlag,
  db,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
} from "../utils/seed";
import {valhallaRoute} from "../utils/valhalla";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;
const USER2 = `${PREFIX}-user-2`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedUser(USER2, "2");
});

afterAll(async () => {
  await cleanAll();
  jest.restoreAllMocks();
});

describe("routing detours", () => {
  const body = {
    originLat: BASE_LAT,
    originLng: BASE_LNG,
    destLat: 10.7758,
    destLng: 106.7019,
  };

  beforeEach(() => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () =>
        valhallaRoute(
          {type: "LineString", coordinates: [[106.66, 10.76]]},
          2450,
          512,
        ),
    } as unknown as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POST /routes detours around a fresh blockage", async () => {
    let routeCalls = 0;
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
    jest.mocked(global.fetch).mockImplementation(async () => {
      routeCalls++;
      const route =
        routeCalls === 1 ?
          valhallaRoute(direct, 2450, 512) :
          valhallaRoute(around, 2600, 560);
      return {
        ok: true,
        json: async () => route,
      } as unknown as Response;
    });
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
    expect(res.body.data).toMatchObject({cached: false});
    expect(res.body.data.routes[0]).toMatchObject({
      source: "detour",
      distanceMeters: 2600,
    });
    expect(res.body.data.routes[0].via ?? null).toBeNull();
    expect(res.body.data.routes[0].hazards[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes detours a long route around mid-line hazards", async () => {
    let routeCalls = 0;
    const direct = {
      type: "LineString",
      coordinates: [
        [106.55, 10.7],
        [106.95, 10.7],
      ],
    };
    const around = {
      type: "LineString",
      coordinates: [
        [106.55, 10.7],
        [106.75, 10.78],
        [106.95, 10.7],
      ],
    };
    const margin = 0.03;
    const legacy = new Set(
      cellsForBounds({
        minLat: 10.7 - margin,
        maxLat: 10.7 + margin,
        minLng: 106.55 - margin,
        maxLng: 106.95 + margin,
      }),
    );
    let hazardLng = 0;
    for (let lng = 106.6; lng <= 106.9; lng += 0.005) {
      if (!legacy.has(encodeGeohash(10.7, lng, 5))) {
        hazardLng = lng;
        break;
      }
    }
    expect(hazardLng).toBeGreaterThan(0);
    jest.mocked(global.fetch).mockImplementation(async () => {
      routeCalls++;
      const route =
        routeCalls === 1 ?
          valhallaRoute(direct, 44000, 5300) :
          valhallaRoute(around, 47000, 5700);
      return {
        ok: true,
        json: async () => route,
      } as unknown as Response;
    });
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.7,
      lng: hazardLng,
      radiusMeters: 200,
      reporterUid: USER,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({
        originLat: 10.7,
        originLng: 106.55,
        destLat: 10.7,
        destLng: 106.95,
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({cached: false});
    expect(res.body.data.routes[0]).toMatchObject({
      source: "detour",
      distanceMeters: 47000,
    });
    expect(res.body.data.routes[0].via ?? null).toBeNull();
    expect(res.body.data.routes[0].hazards[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes detours for the reporter of a suggested flag", async () => {
    const around = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.69, 10.79],
        [106.7, 10.78],
      ],
    };
    jest.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => valhallaRoute(around, 2600, 560),
    } as unknown as Response);
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      reporterUid: USER,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.795, destLng: 106.71});
    expect(res.status).toBe(200);
    expect(res.body.data.routes[0]).toMatchObject({
      source: "detour",
      warnings: [],
    });
    expect(res.body.data.routes[0].via ?? null).toBeNull();
    expect(res.body.data.routes[0].hazards[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes warns other riders about a suggested flag", async () => {
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "1",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
      reporterUid: USER,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER2))
      .send({...body, destLat: 10.795, destLng: 106.71});
    expect(res.status).toBe(200);
    expect(res.body.data.routes[0]).toMatchObject({source: "cache"});
    expect(res.body.data.routes[0].hazards ?? null).toBeNull();
    expect(res.body.data.routes[0].warnings[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
  });
});
