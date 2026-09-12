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
const OTHER = `${PREFIX}-user-2`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedUser(OTHER, "2");
});

afterAll(async () => {
  await cleanAll();
});

describe("saved place endpoints", () => {
  let placeId = "";

  it("POST /places/save creates a saved place", async () => {
    const res = await request(app)
      .post("/places/save")
      .set("Authorization", bearer(USER))
      .send({label: "Home", lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      label: "Home",
      lat: BASE_LAT,
      lng: BASE_LNG,
    });
    expect(res.body.data.id).toBeDefined();
    placeId = res.body.data.id as string;
  });

  it("POST /places/save dedupes by coords and updates the label", async () => {
    const res = await request(app)
      .post("/places/save")
      .set("Authorization", bearer(USER))
      .send({label: "Home Base", lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(placeId);
    expect(res.body.data.label).toBe("Home Base");
  });

  it("POST /places/saved lists my saves across users", async () => {
    const mined = await request(app)
      .post("/places/saved")
      .set("Authorization", bearer(USER))
      .send({});
    expect(mined.status).toBe(200);
    expect((mined.body.data as {id: string}[]).map((p) => p.id)).toEqual([
      placeId,
    ]);
    const others = await request(app)
      .post("/places/saved")
      .set("Authorization", bearer(OTHER))
      .send({});
    expect(others.status).toBe(200);
    expect(others.body.data).toEqual([]);
  });

  it("POST /places/unsave rejects other users places", async () => {
    const res = await request(app)
      .post("/places/unsave")
      .set("Authorization", bearer(OTHER))
      .send({placeId});
    expect(res.status).toBe(403);
  });

  it("POST /places/unsave deletes my saved place", async () => {
    const res = await request(app)
      .post("/places/unsave")
      .set("Authorization", bearer(USER))
      .send({placeId});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({deleted: 1});
    const listed = await request(app)
      .post("/places/saved")
      .set("Authorization", bearer(USER))
      .send({});
    expect(listed.body.data).toEqual([]);
  });

  it("requires auth and valid payloads", async () => {
    const noAuth = await request(app)
      .post("/places/saved")
      .send({});
    expect(noAuth.status).toBe(401);
    const bad = await request(app)
      .post("/places/save")
      .set("Authorization", bearer(USER))
      .send({label: "", lat: BASE_LAT, lng: BASE_LNG});
    expect(bad.status).toBe(400);
  });
});
