import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {
  cleanAll,
  seedUser,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
  db,
} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;
const VOLUNLICENSED = `${PREFIX}-unlicensed`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(VOLUNLICENSED, "2");
});

afterAll(async () => {
  await cleanAll();
});

describe("dispatch endpoints", () => {
  let ticketId = "";

  it("POST /dispatch opens a pending ticket", async () => {
    const res = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        destinationPoint: {lat: 10.71, lng: 106.61},
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("1");
    ticketId = res.body.data.id as string;
  });

  it("POST /dispatch/one reads the ticket", async () => {
    const res = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ticketId);
  });

  it("POST /dispatch/mine lists only the caller tickets", async () => {
    const mine = await request(app)
      .post("/dispatch/mine")
      .set("Authorization", bearer(USER))
      .send({});
    expect(mine.status).toBe(200);
    const ids = (mine.body.data as {id: string}[]).map((t) => t.id);
    expect(ids).toContain(ticketId);
    const other = await request(app)
      .post("/dispatch/mine")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({});
    expect(other.status).toBe(200);
    const otherIds = (other.body.data as {id: string}[]).map((t) => t.id);
    expect(otherIds).not.toContain(ticketId);
  });

  it("PUT /dispatch/status lets the rider cancel", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId, status: "5"});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({updated: 1});
  });

  it("PUT /dispatch/status refuses matched outside accept", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId, status: "2"});
    expect(res.status).toBe(400);
  });

  it("PUT /dispatch/status rejects illegal statuses with 400", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId, status: "FLYING"});
    expect(res.status).toBe(400);
  });

  it("PUT /dispatch/status rejects strangers with 403", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({ticketId, status: "2"});
    expect(res.status).toBe(403);
  });

  it("POST /dispatch/near hides tickets from unavailable callers", async () => {
    const denied = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(denied.status).toBe(200);
    expect(denied.body.data).toEqual([]);
    const onboard = await request(app)
      .put("/users/onboard")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({service: "VOLUNTEER"});
    expect(onboard.status).toBe(200);
    const stillHidden = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(stillHidden.status).toBe(200);
    expect(stillHidden.body.data).toEqual([]);
    const toggle = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({available: true});
    expect(toggle.status).toBe(200);
    const allowed = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(allowed.status).toBe(200);
  });
});

describe("dispatch assist flow", () => {
  const VOL = `${PREFIX}-volunteer`;
  const ADMIN = `${PREFIX}-admin`;
  let shopId = "";
  let destShopId = "";
  let flowTicket = "";

  it("seeds a volunteer and a tow shop", async () => {
    await seedUser(VOL, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "VOLUNTEER"]);
    await seedUser(ADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    const toggle = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(VOL))
      .send({available: true});
    expect(toggle.status).toBe(200);
    const shop = await request(app)
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
    expect(shop.status).toBe(201);
    shopId = shop.body.data.id as string;
    const review = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: "30A12345", approve: true});
    expect(review.status).toBe(200);
    const dest = await request(app)
      .post("/providers")
      .set("Authorization", bearer(USER))
      .send({
        kind: "SHOP",
        name: "Fix Shop",
        lat: BASE_LAT,
        lng: BASE_LNG,
      });
    expect(dest.status).toBe(201);
    destShopId = dest.body.data.id as string;
    const shopReview = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: destShopId, approve: true});
    expect(shopReview.status).toBe(200);
  });

  it("POST /dispatch carries note and destination", async () => {
    const res = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        note: "Alley gate",
        destinationShopId: destShopId,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.note).toBe("Alley gate");
    expect(res.body.data.destinationShopId).toBe(destShopId);
    expect(res.body.data.destinationSnapshot.name).toBe("Fix Shop");
    flowTicket = res.body.data.id as string;
  });

  it("POST /dispatch rejects tow tickets without a destination", async () => {
    const res = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({ticketType: "TOW", lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(400);
  });

  it("POST /dispatch/destination moves the drop-off", async () => {
    const res = await request(app)
      .post("/dispatch/destination")
      .set("Authorization", bearer(USER))
      .send({
        ticketId: flowTicket,
        destinationPoint: {lat: 10.71, lng: 106.61, label: "Home"},
      });
    expect(res.status).toBe(200);
    expect(res.body.data.destinationPoint).toMatchObject({
      lat: 10.71,
      lng: 106.61,
    });
    expect(res.body.data.destinationShopId).toBeNull();
    expect(res.body.data.destinationSnapshot.source).toBe("point");
  });

  it("POST /dispatch/near surfaces pending tow tickets", async () => {
    const tow = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        destinationPoint: {lat: 10.71, lng: 106.61},
        vehicleType: "CAR",
      });
    expect(tow.status).toBe(201);
    const res = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, ticketType: "TOW"});
    expect(res.status).toBe(200);
    const ids = (res.body.data as {id: string}[]).map((t) => t.id);
    expect(ids).toContain(tow.body.data.id as string);
  });

  it("POST /dispatch/offers lists accepting providers", async () => {
    const res = await request(app)
      .post("/dispatch/offers")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, kind: "TOW"});
    expect(res.status).toBe(200);
    const ids = (res.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).toContain(shopId);
  });

  it("POST /dispatch/select records the rider pick", async () => {
    const res = await request(app)
      .post("/dispatch/select")
      .set("Authorization", bearer(USER))
      .send({ticketId: flowTicket, shopId});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({selected: shopId});
  });

  it("POST /dispatch/accept matches the tow and flips it busy", async () => {
    const res = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(USER))
      .send({ticketId: flowTicket, shopId});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({matched: true, kind: "SHOP"});
    const ticket = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: flowTicket});
    expect(ticket.body.data.status).toBe("2");
    expect(ticket.body.data.assignedShopId).toBe(shopId);
  });

  it("rejects kind-mismatched accepts with 400", async () => {
    const ticket = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "MECHANIC",
        lat: BASE_LAT,
        lng: BASE_LNG,
        vehicleType: "SCOOTER",
      });
    expect(ticket.status).toBe(201);
    const res = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(USER))
      .send({ticketId: ticket.body.data.id, shopId});
    expect(res.status).toBe(400);
  });

  it("rejects unapproved tow accepts with 403", async () => {
    const FRESH = `${PREFIX}-fresh-tow`;
    await seedUser(FRESH, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    const shop = await request(app)
      .post("/providers")
      .set("Authorization", bearer(FRESH))
      .send({
        kind: "TOW",
        name: "Unreviewed Tow",
        lat: BASE_LAT,
        lng: BASE_LNG,
        plate: "51F-99999",
        vehicleType: "TRUCK",
      });
    expect(shop.status).toBe(201);
    const ticket = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(FRESH))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        destinationPoint: {lat: 10.71, lng: 106.61},
      });
    expect(ticket.status).toBe(201);
    const res = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(FRESH))
      .send({ticketId: ticket.body.data.id, shopId: shop.body.data.id});
    expect(res.status).toBe(403);
  });

  it("resolving restores tow availability", async () => {
    const arrived = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId: flowTicket, status: "3"});
    expect(arrived.status).toBe(200);
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId: flowTicket, status: "4"});
    expect(res.status).toBe(200);
    const offers = await request(app)
      .post("/dispatch/offers")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG, kind: "TOW"});
    const ids = (offers.body.data as {id: string}[]).map((s) => s.id);
    expect(ids).toContain(shopId);
  });

  it("POST /dispatch/near surfaces pending SOS tickets", async () => {
    const sos = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({ticketType: "SOS", lat: BASE_LAT, lng: BASE_LNG});
    expect(sos.status).toBe(201);
    const res = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(VOL))
      .send({lat: BASE_LAT, lng: BASE_LNG, ticketType: "SOS"});
    expect(res.status).toBe(200);
    const ids = (res.body.data as {id: string}[]).map((t) => t.id);
    expect(ids).toContain(sos.body.data.id as string);
  });

  it("a volunteer accepts an SOS ticket", async () => {
    const sos = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({ticketType: "SOS", lat: BASE_LAT, lng: BASE_LNG});
    const res = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(VOL))
      .send({ticketId: sos.body.data.id});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({matched: true, kind: "VOLUNTEER"});
  });
});

describe("dispatch vehicle and capability flow", () => {
  const BIKE = `${PREFIX}-bikevol`;
  const CARVOL = `${PREFIX}-carvol`;
  let towId = "";

  it("seeds bike-only and car-capable volunteers", async () => {
    await seedUser(BIKE, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "VOLUNTEER"]);
    await seedUser(CARVOL, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "VOLUNTEER"]);
    const bike = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(BIKE))
      .send({available: true, capability: "SOLO_BIKE"});
    expect(bike.status).toBe(200);
    const car = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(CARVOL))
      .send({available: true, capability: "CAR"});
    expect(car.status).toBe(200);
    for (const vol of [BIKE, CARVOL]) {
      const beat = await request(app)
        .post("/users/volunteer/heartbeat")
        .set("Authorization", bearer(vol))
        .send({lat: BASE_LAT, lng: BASE_LNG});
      expect(beat.status).toBe(200);
    }
  });

  it("stores the rider vehicle and a free-form destination", async () => {
    const res = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        destinationPoint: {lat: 10.71, lng: 106.61, label: "Home"},
        vehicleType: "CAR",
        vehicleWidth: 1.9,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.vehicleType).toBe("CAR");
    expect(res.body.data.destinationSnapshot).toMatchObject({
      lat: 10.71,
      lng: 106.61,
      label: "Home",
      source: "point",
    });
  });

  it("matches car SOS tickets to car-capable volunteers only", async () => {
    const sos = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "SOS",
        lat: BASE_LAT,
        lng: BASE_LNG,
        vehicleType: "CAR",
        vehicleWidth: 1.9,
      });
    expect(sos.status).toBe(201);
    expect(sos.body.data.candidates).toEqual([CARVOL]);
    const denied = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(BIKE))
      .send({ticketId: sos.body.data.id});
    expect(denied.status).toBe(403);
    const accepted = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(CARVOL))
      .send({ticketId: sos.body.data.id});
    expect(accepted.status).toBe(200);
  });

  it("labels tow offers with alley fit", async () => {
    towId = "30A12345";
    const wide = await request(app)
      .post("/dispatch/offers")
      .set("Authorization", bearer(USER))
      .send({
        lat: BASE_LAT,
        lng: BASE_LNG,
        kind: "TOW",
        accessWidthMeters: 2.5,
      });
    expect(wide.status).toBe(200);
    const hit = (wide.body.data as {id: string; fitsAlley: unknown}[]).find(
      (s) => s.id === towId,
    );
    expect(hit?.fitsAlley).toBe(true);
    const narrow = await request(app)
      .post("/dispatch/offers")
      .set("Authorization", bearer(USER))
      .send({
        lat: BASE_LAT,
        lng: BASE_LNG,
        kind: "TOW",
        accessWidthMeters: 1.4,
      });
    const miss = (
      narrow.body.data as {id: string; fitsAlley: unknown}[]
    ).find((s) => s.id === towId);
    expect(miss?.fitsAlley).toBe(false);
  });
});

describe("dispatch walk-in flow", () => {
  const WALKOP = `${PREFIX}-walkop`;
  const WALKADMIN = `${PREFIX}-walkadmin`;
  let walkShop = "";
  let walkTicket = "";

  it("opens a walk-in with a shop snapshot and expiry", async () => {
    await seedUser(WALKOP, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    await seedUser(WALKADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
    const shop = await request(app)
      .post("/providers")
      .set("Authorization", bearer(WALKOP))
      .send({
        kind: "SHOP",
        name: "Walk-in Fix",
        lat: BASE_LAT,
        lng: BASE_LNG,
        vehicleClasses: ["SOLO_BIKE"],
      });
    expect(shop.status).toBe(201);
    walkShop = shop.body.data.id as string;
    const review = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(WALKADMIN))
      .send({providerId: walkShop, approve: true});
    expect(review.status).toBe(200);
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "WALK_IN",
        lat: BASE_LAT,
        lng: BASE_LNG,
        providerId: walkShop,
        vehicleType: "SCOOTER",
      });
    expect(opened.status).toBe(201);
    walkTicket = opened.body.data.id as string;
    expect(opened.body.data.providerSnapshot).toMatchObject({
      id: walkShop,
      name: "Walk-in Fix",
    });
    expect(typeof opened.body.data.expiresAt).toBe("string");
  });

  it("surfaces the walk-in in shop requests", async () => {
    const res = await request(app)
      .post("/dispatch/shop/requests")
      .set("Authorization", bearer(WALKOP))
      .send({shopId: walkShop});
    expect(res.status).toBe(200);
    const ids = (res.body.data as {id: string}[]).map((t) => t.id);
    expect(ids).toContain(walkTicket);
  });

  it("stamps the walk-in out for the rider and in for the shop", async () => {
    const out = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(USER))
      .send({});
    expect(out.status).toBe(200);
    const mine = (out.body.data as {id: string; direction: string}[]).find(
      (t) => t.id === walkTicket,
    );
    expect(mine?.direction).toBe("out");
    const inbound = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(WALKOP))
      .send({});
    expect(inbound.status).toBe(200);
    const theirs = (
      inbound.body.data as {id: string; direction: string}[]
    ).find((t) => t.id === walkTicket);
    expect(theirs?.direction).toBe("in");
  });

  it("walks matched to ready with no arrival tap", async () => {
    const accept = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: walkTicket, shopId: walkShop});
    expect(accept.status).toBe(200);
    const work = await request(app)
      .post("/dispatch/work")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: walkTicket, workType: "Chain", quotedAmount: 150000});
    expect(work.status).toBe(200);
    const quoted = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: walkTicket});
    expect(quoted.body.data.status).toBe("9");
    const approve = await request(app)
      .post("/dispatch/quote/approve")
      .set("Authorization", bearer(USER))
      .send({ticketId: walkTicket});
    expect(approve.status).toBe(200);
    const started = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: walkTicket});
    expect(started.body.data.status).toBe("6");
    const ready = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: walkTicket, status: "7"});
    expect(ready.status).toBe(200);
    const ticket = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: walkTicket});
    expect(ticket.body.data.fulfilledByShopId).toBe(walkShop);
    const resolved = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId: walkTicket, status: "4"});
    expect(resolved.status).toBe(200);
  });

  it("records the walk-in status history with actors", async () => {
    const res = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: walkTicket});
    expect(res.status).toBe(200);
    type HistoryRow = {status: string; by: string};
    const history = res.body.data.statusHistory as HistoryRow[];
    expect(history.map((h) => h.status)).toEqual(
      ["1", "2", "9", "6", "7", "4"],
    );
    expect(history.map((h) => h.by)).toEqual(
      [USER, WALKOP, WALKOP, USER, WALKOP, USER],
    );
  });

  it("names the counterparty on both feed sides", async () => {
    await db.collection("users").doc(USER).update({displayName: "Rider One"});
    const relabeled = await request(app)
      .put("/providers")
      .set("Authorization", bearer(WALKOP))
      .send({providerId: walkShop, label: "12 Le Loi"});
    expect(relabeled.status).toBe(200);
    const out = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(USER))
      .send({});
    type FeedRow = {id: string; otherParty: unknown};
    const mine = (out.body.data as FeedRow[]).find(
      (t) => t.id === walkTicket,
    );
    expect(mine?.otherParty).toEqual(
      {
        id: walkShop,
        name: "Walk-in Fix",
        kind: "SHOP",
        label: "12 Le Loi",
        ratingAvg: 0,
        ratingCount: 0,
      },
    );
    const inbound = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(WALKOP))
      .send({});
    const theirs = (inbound.body.data as FeedRow[]).find(
      (t) => t.id === walkTicket,
    );
    expect(theirs?.otherParty).toEqual(
      {id: USER, name: "Rider One", kind: "RIDER"},
    );
  });

  it("rates and replies on the fulfilled walk-in", async () => {
    const rated = await request(app)
      .post("/ratings")
      .set("Authorization", bearer(USER))
      .send({
        targetId: walkShop,
        targetKind: "SHOP",
        ticketId: walkTicket,
        score: 5,
      });
    expect(rated.status).toBe(200);
    const dist = await request(app)
      .post("/providers/ratings")
      .set("Authorization", bearer(USER))
      .send({providerId: walkShop});
    expect(dist.status).toBe(200);
    const rating = (dist.body.data.ratings as {id: string}[])[0];
    expect(rating).toBeDefined();
    const reply = await request(app)
      .post("/ratings/reply")
      .set("Authorization", bearer(WALKOP))
      .send({ratingId: rating?.id, reply: "Thanks!"});
    expect(reply.status).toBe(200);
  });

  it("declines with a reason", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "WALK_IN",
        lat: BASE_LAT,
        lng: BASE_LNG,
        providerId: walkShop,
        vehicleType: "SCOOTER",
      });
    expect(opened.status).toBe(201);
    const second = opened.body.data.id as string;
    const declined = await request(app)
      .post("/dispatch/decline")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: second, shopId: walkShop, reason: "FULL"});
    expect(declined.status).toBe(200);
    const ticket = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: second});
    expect(ticket.body.data.status).toBe("8");
    expect(ticket.body.data.declineReason).toBe("FULL");
  });

  it("keeps declined walk-ins on both sides", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "WALK_IN",
        lat: BASE_LAT,
        lng: BASE_LNG,
        providerId: walkShop,
        vehicleType: "SCOOTER",
      });
    expect(opened.status).toBe(201);
    const third = opened.body.data.id as string;
    const declined = await request(app)
      .post("/dispatch/decline")
      .set("Authorization", bearer(WALKOP))
      .send({
        ticketId: third,
        shopId: walkShop,
        reason: "FULL",
        note: "Busy",
      });
    expect(declined.status).toBe(200);
    type FeedRow = {
      id: string;
      direction: string;
      status: string;
      otherParty: unknown;
    };
    const out = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(USER))
      .send({});
    const mine = (out.body.data as FeedRow[]).find((t) => t.id === third);
    expect(mine?.direction).toBe("out");
    expect(mine?.status).toBe("8");
    expect(mine?.otherParty).toEqual({
      id: walkShop,
      name: "Walk-in Fix",
      kind: "SHOP",
      label: "12 Le Loi",
      ratingAvg: 5,
      ratingCount: 1,
    });
    const inbound = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(WALKOP))
      .send({});
    const theirs = (inbound.body.data as FeedRow[]).find(
      (t) => t.id === third,
    );
    expect(theirs?.direction).toBe("in");
    expect(theirs?.status).toBe("8");
    expect(theirs?.otherParty).toEqual({
      id: USER,
      name: "Rider One",
      kind: "RIDER",
    });
  });

  it("quotes and approves before work starts", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(USER))
      .send({
        ticketType: "WALK_IN",
        lat: BASE_LAT,
        lng: BASE_LNG,
        providerId: walkShop,
        vehicleType: "SCOOTER",
      });
    expect(opened.status).toBe(201);
    const quotedTicket = opened.body.data.id as string;
    const acceptQuoted = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: quotedTicket, shopId: walkShop});
    expect(acceptQuoted.status).toBe(200);
    const send = await request(app)
      .post("/dispatch/quote")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: quotedTicket, quotedAmount: 150000});
    expect(send.status).toBe(200);
    const pending = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: quotedTicket});
    expect(pending.body.data.status).toBe("9");
    expect(pending.body.data.shopQuotedAmount).toBe(150000);
    const blocked = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(WALKOP))
      .send({ticketId: quotedTicket, status: "6"});
    expect(blocked.status).toBe(403);
    const approve = await request(app)
      .post("/dispatch/quote/approve")
      .set("Authorization", bearer(USER))
      .send({ticketId: quotedTicket});
    expect(approve.status).toBe(200);
    const started = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({ticketId: quotedTicket});
    expect(started.body.data.status).toBe("6");
  });

  it("shares phones on live tickets only", async () => {
    await db.collection("users").doc(USER).update({phone: "+84001"});
    await db.collection("users").doc(WALKOP).update({phone: "+84002"});
    type FeedRow = {id: string; otherParty: unknown};
    const out = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(USER))
      .send({});
    const mine = (out.body.data as FeedRow[]).find(
      (t) => t.id === walkTicket,
    );
    expect(mine?.otherParty).toEqual(
      expect.objectContaining({phone: "+84002"}),
    );
    const inbound = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(WALKOP))
      .send({});
    const theirs = (inbound.body.data as FeedRow[]).find(
      (t) => t.id === walkTicket,
    );
    expect(theirs?.otherParty).toEqual(
      expect.objectContaining({phone: "+84001"}),
    );
  });
});
