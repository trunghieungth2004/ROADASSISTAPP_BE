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
import {valhallaRoute} from "../utils/valhalla";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;

const primary = {
  type: "LineString",
  coordinates: [
    [106.66, 10.76],
    [106.7, 10.78],
  ],
};
const alt1 = {
  type: "LineString",
  coordinates: [
    [106.66, 10.76],
    [106.67, 10.79],
    [106.7, 10.78],
  ],
};
const alt2 = {
  type: "LineString",
  coordinates: [
    [106.66, 10.76],
    [106.65, 10.745],
    [106.7, 10.78],
  ],
};

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
});

afterAll(async () => {
  await cleanAll();
  jest.restoreAllMocks();
});

describe("routing alternatives", () => {
  const body = {
    originLat: BASE_LAT,
    originLng: BASE_LNG,
  };

  beforeEach(() => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () =>
        valhallaRoute(primary, 2450, 512, [
          {geometry: alt1, distanceMeters: 2600, durationSeconds: 560},
          {geometry: alt2, distanceMeters: 2800, durationSeconds: 610},
        ]),
    } as unknown as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("POST /routes returns 3 options on a clean two-point route", async () => {
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.7758, destLng: 106.7019});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({cached: false});
    expect(res.body.data.routes).toHaveLength(3);
    expect(
      res.body.data.routes.map(
        (r: {distanceMeters: number}) => r.distanceMeters,
      ),
    ).toEqual([2450, 2600, 2800]);
    expect(res.body.data.routes[0]).toMatchObject({
      source: "valhalla",
      durationSeconds: 512,
    });
    expect(res.body.data.routes[0].geometry).toEqual(primary);
    expect(res.body.data.routes[1].geometry).toEqual(alt1);
    expect(res.body.data.routes[2].geometry).toEqual(alt2);
    const [, init] = jest.mocked(global.fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = JSON.parse(init.body as string) as {alternates?: number};
    expect(sent.alternates).toBe(2);
  });

  it("POST /routes drops a hazard-blocked alternative", async () => {
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.745,
      lng: 106.65,
      radiusMeters: 200,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.7761, destLng: 106.7021});
    expect(res.status).toBe(200);
    expect(res.body.data.routes).toHaveLength(2);
    expect(res.body.data.routes[0].geometry).toEqual(primary);
    expect(res.body.data.routes[1].geometry).toEqual(alt1);
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes falls back when the primary stays blocked", async () => {
    let routeCalls = 0;
    jest.mocked(global.fetch).mockImplementation(async () => {
      routeCalls++;
      const route =
        routeCalls === 1 ?
          valhallaRoute(primary, 2450, 512, [
            {geometry: alt1, distanceMeters: 2600, durationSeconds: 560},
          ]) :
          valhallaRoute(primary, 2450, 512);
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
    expect(res.body.data.routes).toHaveLength(1);
    expect(res.body.data.routes[0]).toMatchObject({
      source: "valhalla",
      distanceMeters: 2600,
    });
    expect(res.body.data.routes[0].geometry).toEqual(alt1);
    await db.collection("flags").doc(floodId).delete();
  });

  it("POST /routes 409s when no option is safe", async () => {
    const floodId = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.77,
      lng: 106.68,
      radiusMeters: 200,
    });
    const flood2Id = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.79,
      lng: 106.67,
      radiusMeters: 200,
    });
    const alt2FloodId = await seedFlag({
      type: "FLOOD",
      status: "2",
      lat: 10.745,
      lng: 106.65,
      radiusMeters: 200,
    });
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({...body, destLat: 10.796, destLng: 106.711});
    expect(res.status).toBe(409);
    expect(res.body.errors[0]).toMatchObject({
      flagId: floodId,
      type: "FLOOD",
    });
    await db.collection("flags").doc(floodId).delete();
    await db.collection("flags").doc(flood2Id).delete();
    await db.collection("flags").doc(alt2FloodId).delete();
  });
});
