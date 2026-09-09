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
const ADMIN = `${PREFIX}-admin`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedUser(ADMIN, "1");
});

afterAll(async () => {
  await cleanAll();
});

describe("alley segment endpoints", () => {
  let segmentId = "";

  it("POST /alleys creates a segment", async () => {
    const res = await request(app)
      .post("/alleys")
      .set("Authorization", bearer(USER))
      .send({
        userId: USER,
        lat: BASE_LAT,
        lng: BASE_LNG,
        baseWidth: 1.2,
        tier: "TIER2",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    segmentId = res.body.data.id as string;
  });

  it("POST /alleys/segment reads the segment", async () => {
    const res = await request(app)
      .post("/alleys/segment")
      .set("Authorization", bearer(USER))
      .send({userId: USER, segmentId});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(segmentId);
  });

  it("POST /alleys/segment returns 404 for unknown segments", async () => {
    const res = await request(app)
      .post("/alleys/segment")
      .set("Authorization", bearer(USER))
      .send({userId: USER, segmentId: "ghost"});
    expect(res.status).toBe(404);
  });

  it("POST /alleys/near finds the segment", async () => {
    const res = await request(app)
      .post("/alleys/near")
      .set("Authorization", bearer(USER))
      .send({userId: USER, lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    expect(res.body.data.map((s: {id: string}) => s.id)).toContain(segmentId);
  });

  it("PUT /alleys/passability overwrites measurements", async () => {
    const res = await request(app)
      .put("/alleys/passability")
      .set("Authorization", bearer(USER))
      .send({userId: USER, segmentId, baseWidth: 1.1, tier: "TIER2"});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({updated: 1});
  });

  it("PUT /alleys/moderate patches as admin", async () => {
    const res = await request(app)
      .put("/alleys/moderate")
      .set("Authorization", bearer(ADMIN))
      .send({userId: ADMIN, segmentId, verifiedCount: 5});
    expect(res.status).toBe(200);
    const reread = await request(app)
      .post("/alleys/segment")
      .set("Authorization", bearer(USER))
      .send({userId: USER, segmentId});
    expect(reread.body.data.verifiedCount).toBe(5);
  });
});
