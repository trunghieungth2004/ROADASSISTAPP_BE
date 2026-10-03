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
const ADMIN = `${PREFIX}-admin`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(ADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
});

afterAll(async () => {
  await cleanAll();
});

describe("provider endpoints", () => {
  it("POST /providers creates a shop without any license", async () => {
    const shop = await request(app)
      .post("/providers")
      .set("Authorization", bearer(USER))
      .send({
        kind: "SHOP",
        name: "Fix",
        lat: BASE_LAT,
        lng: BASE_LNG,
      });
    expect(shop.status).toBe(201);
    expect(shop.body.data.status).toBe("ACTIVE");
    expect(shop.body.data.operatorUid).toBe(USER);
  });

  it("POST /providers rejects a second shop for one operator", async () => {
    const dup = await request(app)
      .post("/providers")
      .set("Authorization", bearer(USER))
      .send({
        kind: "SHOP",
        name: "Second",
        lat: BASE_LAT,
        lng: BASE_LNG,
      });
    expect(dup.status).toBe(409);
  });

  it("POST /providers files a pending tow provider", async () => {
    const tow = await request(app)
      .post("/providers")
      .set("Authorization", bearer(USER))
      .send({
        kind: "TOW",
        name: "Tow Co",
        lat: BASE_LAT,
        lng: BASE_LNG,
        plate: "30A-12345",
        vehicleType: "VAN",
        vehicleWidth: 2.0,
      });
    expect(tow.status).toBe(201);
    expect(tow.body.data.status).toBe("PENDING");
    expect(tow.body.data.plate).toBe("30A12345");
  });

  it("POST /providers/near lists with distances", async () => {
    const res = await request(app)
      .post("/providers/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const shop of res.body.data as {distance: unknown}[]) {
      expect(typeof shop.distance).toBe("number");
    }
  });

  it("POST /providers/near hides pending tow providers", async () => {
    const res = await request(app)
      .post("/providers/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, kind: "TOW"});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("POST /providers/pending lists tow requests for admins", async () => {
    const res = await request(app)
      .post("/providers/pending")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(res.status).toBe(200);
    const plates = (res.body.data as {plate: string}[]).map((r) => r.plate);
    expect(plates).toContain("30A12345");
  });

  it("POST /providers/review approves and surfaces the tow", async () => {
    const review = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: "30A12345", approve: true});
    expect(review.status).toBe(200);
    expect(review.body.data).toMatchObject({decided: true, status: "ACTIVE"});
    const res = await request(app)
      .post("/providers/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, kind: "TOW"});
    expect(res.status).toBe(200);
    const ids = (res.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).toContain("30A12345");
  });

  it("POST /providers/review rejects a second review as decided", async () => {
    const review = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: "30A12345", approve: true});
    expect(review.status).toBe(200);
    expect(review.body.data).toMatchObject({decided: false});
  });
});

describe("provider availability flow", () => {
  it("PUT /providers toggles availability", async () => {
    const mine = await request(app)
      .post("/providers/mine")
      .set("Authorization", bearer(USER))
      .send({});
    expect(mine.status).toBe(200);
    const shop = (mine.body.data as {id: string; kind: string}[]).find(
      (p) => p.kind === "SHOP",
    );
    const res = await request(app)
      .put("/providers")
      .set("Authorization", bearer(USER))
      .send({providerId: shop?.id, accepting: false});
    expect(res.status).toBe(200);
    const offers = await request(app)
      .post("/providers/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, acceptingOnly: true});
    expect(offers.status).toBe(200);
    const ids = (offers.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).not.toContain(shop?.id);
  });
});

describe("provider moderation flow", () => {
  const RIDER = `${PREFIX}-reporter`;
  const TOWOP = `${PREFIX}-towop`;
  const NONADMIN = `${PREFIX}-nonadmin`;

  it("sets up a reporter, a tow operator and a bystander", async () => {
    await seedUser(RIDER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    await seedUser(TOWOP, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    await seedUser(NONADMIN, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    const tow = await request(app)
      .post("/providers")
      .set("Authorization", bearer(TOWOP))
      .send({
        kind: "TOW",
        name: "Reportable Tow",
        lat: BASE_LAT,
        lng: BASE_LNG,
        plate: "77X-11111",
        vehicleType: "VAN",
      });
    expect(tow.status).toBe(201);
    const review = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: "77X11111", approve: true});
    expect(review.status).toBe(200);
  });

  it("POST /providers/report files with 201 and dedupes with 409", async () => {
    const mine = await request(app)
      .post("/providers/mine")
      .set("Authorization", bearer(TOWOP))
      .send({});
    const towId = (mine.body.data as {id: string}[])[0].id;
    const first = await request(app)
      .post("/providers/report")
      .set("Authorization", bearer(RIDER))
      .send({providerId: towId, reason: "FAKE_BUSINESS"});
    expect(first.status).toBe(201);
    const dupe = await request(app)
      .post("/providers/report")
      .set("Authorization", bearer(RIDER))
      .send({providerId: towId, reason: "SPAM"});
    expect(dupe.status).toBe(409);
  });

  it("POST /providers/report rejects bad reasons with 400", async () => {
    const mine = await request(app)
      .post("/providers/mine")
      .set("Authorization", bearer(TOWOP))
      .send({});
    const towId = (mine.body.data as {id: string}[])[0].id;
    const res = await request(app)
      .post("/providers/report")
      .set("Authorization", bearer(NONADMIN))
      .send({providerId: towId, reason: "NOPE"});
    expect(res.status).toBe(400);
  });

  it("suspend hides the provider, restore brings it back", async () => {
    const mine = await request(app)
      .post("/providers/mine")
      .set("Authorization", bearer(TOWOP))
      .send({});
    const towId = (mine.body.data as {id: string}[])[0].id;
    const forbidden = await request(app)
      .post("/providers/suspend")
      .set("Authorization", bearer(NONADMIN))
      .send({providerId: towId});
    expect(forbidden.status).toBe(403);
    const suspend = await request(app)
      .post("/providers/suspend")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: towId, reason: "fake business"});
    expect(suspend.status).toBe(200);
    const offers = await request(app)
      .post("/dispatch/offers")
      .set("Authorization", bearer(RIDER))
      .send({lat: BASE_LAT, lng: BASE_LNG, kind: "TOW"});
    expect(offers.status).toBe(200);
    const ids = (offers.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).not.toContain(towId);
    const search = await request(app)
      .post("/places/search")
      .set("Authorization", bearer(RIDER))
      .send({q: "reportable"});
    expect(search.status).toBe(200);
    const names = (search.body.data as {label: string}[]).map((p) => p.label);
    expect(names).not.toContain("Reportable Tow");
    const restore = await request(app)
      .post("/providers/restore")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: towId});
    expect(restore.status).toBe(200);
    expect(restore.body.data).toMatchObject({restored: true});
    const back = await request(app)
      .post("/dispatch/offers")
      .set("Authorization", bearer(RIDER))
      .send({lat: BASE_LAT, lng: BASE_LNG, kind: "TOW"});
    expect(back.status).toBe(200);
    const backIds = (back.body.data as {id: string}[]).map((s) => s.id);
    expect(backIds).toContain(towId);
  });

  it("POST /providers/location tracks only on-duty tow providers", async () => {
    const off = await request(app)
      .post("/providers/location")
      .set("Authorization", bearer(TOWOP))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({providerId: "77X11111"});
    const mine = await request(app)
      .post("/providers/mine")
      .set("Authorization", bearer(TOWOP))
      .send({});
    const towId = (mine.body.data as {id: string}[])[0].id;
    await request(app)
      .put("/providers")
      .set("Authorization", bearer(TOWOP))
      .send({providerId: towId, accepting: false});
    const denied = await request(app)
      .post("/providers/location")
      .set("Authorization", bearer(TOWOP))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(denied.status).toBe(403);
    await request(app)
      .put("/providers")
      .set("Authorization", bearer(TOWOP))
      .send({providerId: towId, accepting: true});
  });

  it("dismisses an open report", async () => {
    const pending = await request(app)
      .post("/providers/reports")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(pending.status).toBe(200);
    const open = (pending.body.data as {id: string}[]).filter(Boolean);
    if (open.length > 0) {
      const dismiss = await request(app)
        .post("/providers/reports/dismiss")
        .set("Authorization", bearer(ADMIN))
        .send({reportId: open[0].id});
      expect(dismiss.status).toBe(200);
      expect(dismiss.body.data).toMatchObject({dismissed: true});
    }
    const again = await request(app)
      .post("/providers/reports")
      .set("Authorization", bearer(NONADMIN))
      .send({});
    expect(again.status).toBe(403);
  });

  it("rejects kind mismatches and bad payloads", async () => {
    const badTow = await request(app)
      .post("/providers")
      .set("Authorization", bearer(NONADMIN))
      .send({kind: "TOW", name: "No Plate", lat: BASE_LAT, lng: BASE_LNG});
    expect(badTow.status).toBe(400);
    const badShop = await request(app)
      .post("/providers")
      .set("Authorization", bearer(NONADMIN))
      .send({
        kind: "SHOP",
        name: "Plate Shop",
        lat: BASE_LAT,
        lng: BASE_LNG,
        plate: "30A12345",
      });
    expect(badShop.status).toBe(400);
    const noAuth = await request(app)
      .post("/providers/mine")
      .send({});
    expect(noAuth.status).toBe(401);
    const pending = await request(app)
      .post("/providers/pending")
      .set("Authorization", bearer(NONADMIN))
      .send({});
    expect(pending.status).toBe(403);
  });
});
