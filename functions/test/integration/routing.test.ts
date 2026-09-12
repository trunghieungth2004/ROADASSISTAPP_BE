import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  seedFlag,
  seedSegment,
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

const geometry = {type: "LineString", coordinates: [[106.66, 10.76]]};

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedUser(USER2, "2");
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
      json: async () => valhallaRoute(geometry, 2450, 512),
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
    expect(miss.body.data).toMatchObject({cached: false});
    expect(miss.body.data.routes[0]).toMatchObject({
      source: "valhalla",
      distanceMeters: 2450,
    });
    const hit = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send(body);
    expect(hit.status).toBe(200);
    expect(hit.body.data).toMatchObject({cached: true});
    expect(hit.body.data.routes[0]).toMatchObject({
      source: "cache",
      distanceMeters: 2450,
      durationSeconds: 512,
    });
    expect(hit.body.data.routes[0].geometry).toEqual(geometry);
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

  it("POST /routes unblocks after the flood is gone", async () => {
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({cached: true});
    expect(res.body.data.routes[0]).toMatchObject({source: "cache"});
  });

  it("POST /routes routes through stops in order", async () => {
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, stops: [{lat: 10.77, lng: 106.68}]});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({cached: false});
    expect(res.body.data.routes[0]).toMatchObject({source: "valhalla"});
    expect(res.body.data.routes).toHaveLength(1);
    const [, init] = jest.mocked(global.fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = JSON.parse(init.body as string) as {
      locations: Array<{lat: number; lon: number}>;
      costing: string;
      alternates?: number;
    };
    expect(sent.costing).toBe("motor_scooter");
    expect(sent.locations).toEqual([
      {lat: BASE_LAT, lon: BASE_LNG},
      {lat: 10.77, lon: 106.68},
      {lat: 10.7758, lon: 106.7019},
    ]);
    expect(sent.alternates).toBeUndefined();
  });

  it("POST /routes rejects too many stops", async () => {
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({
        ...body,
        stops: Array.from({length: 11}, () => ({lat: 10.77, lng: 106.68})),
      });
    expect(res.status).toBe(400);
  });

  it("POST /routes returns 500 when Valhalla is down", async () => {
    jest.restoreAllMocks();
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.79});
    expect(res.status).toBe(500);
  });

  it("POST /routes 409s on a narrower segment", async () => {
    const geometry = {
      type: "LineString",
      coordinates: [
        [106.66, 10.76],
        [106.7, 10.78],
      ],
    };
    jest.mocked(global.fetch).mockImplementation(async () => {
      return {
        ok: true,
        json: async () => valhallaRoute(geometry, 2450, 512),
      } as unknown as Response;
    });
    const segId = await seedSegment({
      lat: 10.77,
      lng: 106.68,
      baseWidth: 0.5,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, width: 0.9, destLat: 10.796, destLng: 106.711});
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      "Route is impassable for this vehicle width",
    );
    expect(res.body.errors[0]).toMatchObject({
      segmentId: segId,
      baseWidth: 0.5,
    });
    await db.collection("alley_segments").doc(segId).delete();
  });
});
