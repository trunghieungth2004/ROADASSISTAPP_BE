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

describe("shop endpoints", () => {
  it("POST /shops registers shops and pumps", async () => {
    const shop = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Fix",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "SHOP",
      });
    expect(shop.status).toBe(201);
    const pump = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Fuel",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "PUMP",
      });
    expect(pump.status).toBe(201);
  });

  it("POST /shops/near lists with distances", async () => {
    const res = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    for (const shop of res.body.data as {distance: unknown}[]) {
      expect(typeof shop.distance).toBe("number");
    }
  });

  it("POST /shops/near filters by type", async () => {
    const res = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, type: "PUMP"});
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const shop of res.body.data as {type: string}[]) {
      expect(shop.type).toBe("PUMP");
    }
  });
});
