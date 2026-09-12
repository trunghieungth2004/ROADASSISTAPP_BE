import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  seedShop,
  seedLandmark,
  PREFIX,
} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedShop({name: "Demo Moto Repair"});
  await seedShop({name: "Other Storefront"});
  await seedLandmark({displayLabel: "Demo Landmark Hall"});
});

afterAll(async () => {
  await cleanAll();
});

describe("places endpoints", () => {
  it("POST /places/search merges shops before landmarks", async () => {
    const res = await request(app)
      .post("/places/search")
      .set("Authorization", bearer(USER))
      .send({q: "demo"});
    expect(res.status).toBe(200);
    const kinds = (res.body.data as {kind: string}[]).map((p) => p.kind);
    expect(kinds).toEqual(["shop", "landmark"]);
    expect(res.body.data[0]).toMatchObject({label: "Demo Moto Repair"});
    expect(res.body.data[1]).toMatchObject({label: "Demo Landmark Hall"});
  });

  it("POST /places/search is prefix-scoped", async () => {
    const res = await request(app)
      .post("/places/search")
      .set("Authorization", bearer(USER))
      .send({q: "other"});
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({label: "Other Storefront"});
  });

  it("POST /places/search rejects short queries with 400", async () => {
    const res = await request(app)
      .post("/places/search")
      .set("Authorization", bearer(USER))
      .send({q: "x"});
    expect(res.status).toBe(400);
  });

  it("POST /places/search rejects missing tokens with 401", async () => {
    const res = await request(app).post("/places/search").send({q: "demo"});
    expect(res.status).toBe(401);
  });
});
