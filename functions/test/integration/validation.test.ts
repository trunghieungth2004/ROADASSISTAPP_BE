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

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
});

afterAll(async () => {
  await cleanAll();
});

describe("validation edge cases", () => {
  it("rejects out-of-range coordinates with 400", async () => {
    const res = await request(app)
      .post("/alleys")
      .set("Authorization", bearer(USER))
      .send({userId: USER, lat: 200, lng: BASE_LNG, tier: "TIER1"});
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  it("rejects invalid enums with 400", async () => {
    const res = await request(app)
      .post("/flags")
      .set("Authorization", bearer(USER))
      .send({userId: USER, type: "FIRE", lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(400);
  });

  it("rejects missing userId with 400", async () => {
    const res = await request(app)
      .post("/alleys/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(400);
  });

  it("strips unknown fields", async () => {
    const res = await request(app)
      .post("/alleys")
      .set("Authorization", bearer(USER))
      .send({
        userId: USER,
        lat: BASE_LAT,
        lng: BASE_LNG,
        tier: "TIER1",
        injected: "nope",
      });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty("injected");
  });
});
