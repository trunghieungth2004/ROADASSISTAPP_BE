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
const OTHER = `${PREFIX}-user-9`;

const payload = {
  name: "Morning commute",
  originLat: BASE_LAT,
  originLng: BASE_LNG,
  destLat: 10.7758,
  destLng: 106.7019,
  stops: [{lat: 10.77, lng: 106.68}],
  width: 0.8,
  distanceMeters: 5766,
  durationSeconds: 1200,
  source: "valhalla",
  geometry: {type: "LineString", coordinates: [[106.6602, 10.7626]]},
};

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedUser(OTHER, "2");
});

afterAll(async () => {
  await cleanAll();
});

describe("saved route endpoints", () => {
  let routeId = "";

  it("POST /routes/save stores a route", async () => {
    const res = await request(app)
      .post("/routes/save")
      .set("Authorization", bearer(USER))
      .send(payload);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      userId: USER,
      name: "Morning commute",
      distanceMeters: 5766,
    });
    routeId = res.body.data.id as string;
  });

  it("POST /routes/save rejects geometry-less payloads", async () => {
    const rest: Record<string, unknown> = {...payload};
    delete rest.geometry;
    const res = await request(app)
      .post("/routes/save")
      .set("Authorization", bearer(USER))
      .send(rest);
    expect(res.status).toBe(400);
  });

  it("POST /routes/saved lists summaries without geometry", async () => {
    const res = await request(app)
      .post("/routes/saved")
      .set("Authorization", bearer(USER))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({id: routeId});
    expect(res.body.data[0]).not.toHaveProperty("geometry");
  });

  it("POST /routes/saved hides other users' routes", async () => {
    const res = await request(app)
      .post("/routes/saved")
      .set("Authorization", bearer(OTHER))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("POST /routes/saved/one returns the full record", async () => {
    const res = await request(app)
      .post("/routes/saved/one")
      .set("Authorization", bearer(USER))
      .send({routeId});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: routeId,
      geometry: payload.geometry,
    });
  });

  it("POST /routes/saved/one forbids strangers", async () => {
    const res = await request(app)
      .post("/routes/saved/one")
      .set("Authorization", bearer(OTHER))
      .send({routeId});
    expect(res.status).toBe(403);
  });

  it("PUT /routes/saved renames the owner's route", async () => {
    const res = await request(app)
      .put("/routes/saved")
      .set("Authorization", bearer(USER))
      .send({routeId, name: "Evening commute"});
    expect(res.status).toBe(200);
    const one = await request(app)
      .post("/routes/saved/one")
      .set("Authorization", bearer(USER))
      .send({routeId});
    expect(one.body.data.name).toBe("Evening commute");
  });

  it("POST /routes/unsave deletes the owner's route", async () => {
    const stranger = await request(app)
      .post("/routes/unsave")
      .set("Authorization", bearer(OTHER))
      .send({routeId});
    expect(stranger.status).toBe(403);
    const removed = await request(app)
      .post("/routes/unsave")
      .set("Authorization", bearer(USER))
      .send({routeId});
    expect(removed.status).toBe(200);
    const listed = await request(app)
      .post("/routes/saved")
      .set("Authorization", bearer(USER))
      .send({});
    expect(listed.body.data).toEqual([]);
  });
});
