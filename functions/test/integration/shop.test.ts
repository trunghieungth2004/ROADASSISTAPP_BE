import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
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
  await seedUser(USER, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "SHOP"]);
});

afterAll(async () => {
  await cleanAll();
});

describe("shop endpoints", () => {
  it("POST /shops registers shops and mobile units", async () => {
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
    const mobile = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Fuel",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "MOBILE",
      });
    expect(mobile.status).toBe(201);
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
      .send({lat: BASE_LAT, lng: BASE_LNG, type: "MOBILE"});
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const shop of res.body.data as {type: string}[]) {
      expect(shop.type).toBe("MOBILE");
    }
  });
});

describe("shop availability flow", () => {
  let shopId = "";

  it("POST /shops registers a tow with hours", async () => {
    const res = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Tow",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "TOW",
        openHours: "MON 00:00-23:59,TUE 00:00-23:59,WED 00:00-23:59," +
          "THU 00:00-23:59,FRI 00:00-23:59,SAT 00:00-23:59,SUN 00:00-23:59",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe("TOW");
    expect(res.body.data.accepting).toBe(true);
    expect(res.body.data.operatorUid).toBe(USER);
    shopId = res.body.data.id as string;
  });

  it("POST /shops/near attaches openNow", async () => {
    const res = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, type: "TOW"});
    expect(res.status).toBe(200);
    const hit = (res.body.data as {id: string; openNow: unknown}[]).find(
      (s) => s.id === shopId,
    );
    expect(hit?.openNow).toBe(true);
  });

  it("PUT /shops toggles availability", async () => {
    const res = await request(app)
      .put("/shops")
      .set("Authorization", bearer(USER))
      .send({shopId, accepting: false});
    expect(res.status).toBe(200);
    const offers = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, acceptingOnly: true});
    expect(offers.status).toBe(200);
    const ids = (offers.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).not.toContain(shopId);
  });
});

describe("shop tow vehicle flow", () => {
  let towId = "";

  it("POST /shops stores the tow vehicle", async () => {
    const res = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Fleet Tow",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "TOW",
        hasTow: true,
        towVehicleType: "TRUCK",
        towVehicleWidth: 2.3,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.towVehicleType).toBe("TRUCK");
    expect(res.body.data.towVehicleWidth).toBe(2.3);
    towId = res.body.data.id as string;
  });

  it("PUT /shops updates the tow vehicle", async () => {
    const res = await request(app)
      .put("/shops")
      .set("Authorization", bearer(USER))
      .send({shopId: towId, towVehicleType: "VAN", towVehicleWidth: 2.0});
    expect(res.status).toBe(200);
    const near = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, type: "TOW"});
    const hit = (
      near.body.data as {
        id: string;
        towVehicleType: string;
        towVehicleWidth: number;
      }[]
    ).find((s) => s.id === towId);
    expect(hit?.towVehicleType).toBe("VAN");
    expect(hit?.towVehicleWidth).toBe(2.0);
  });
});

describe("shop license revocation", () => {
  const OP = `${PREFIX}-operator`;
  const ADMIN = `${PREFIX}-admin`;
  let shopId = "";

  it("revoking SHOP unlists the operator shops", async () => {
    await seedUser(OP, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "SHOP"]);
    await seedUser(ADMIN, "1");
    const created = await request(app)
      .post("/shops")
      .set("Authorization", bearer(OP))
      .send({name: "Revoke Me", lat: BASE_LAT, lng: BASE_LNG, type: "SHOP"});
    expect(created.status).toBe(201);
    shopId = created.body.data.id as string;
    const revoke = await request(app)
      .put("/users/services")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: OP, revoke: ["SHOP"]});
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.unlistedShops).toBe(1);
    const offers = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(OP))
      .send({lat: BASE_LAT, lng: BASE_LNG, acceptingOnly: true});
    const ids = (offers.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).not.toContain(shopId);
  });

  it("locks the revoked operator out of shop edits", async () => {
    const res = await request(app)
      .put("/shops")
      .set("Authorization", bearer(OP))
      .send({shopId, accepting: true});
    expect(res.status).toBe(403);
  });

  it("lets an admin re-list the shop", async () => {
    const res = await request(app)
      .put("/shops")
      .set("Authorization", bearer(ADMIN))
      .send({shopId, accepting: true});
    expect(res.status).toBe(200);
    const offers = await request(app)
      .post("/shops/near")
      .set("Authorization", bearer(OP))
      .send({lat: BASE_LAT, lng: BASE_LNG, acceptingOnly: true});
    const ids = (offers.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).toContain(shopId);
  });
});
