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
const VOLUNLICENSED = `${PREFIX}-unlicensed`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "SHOP"]);
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

  it("PUT /dispatch/status advances the ticket", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({ticketId, status: "2"});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({updated: 1});
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

  it("POST /dispatch/near requires a provider license", async () => {
    const denied = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(denied.status).toBe(403);
    const onboard = await request(app)
      .put("/users/onboard")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({service: "VOLUNTEER"});
    expect(onboard.status).toBe(200);
    const allowed = await request(app)
      .post("/dispatch/near")
      .set("Authorization", bearer(VOLUNLICENSED))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(allowed.status).toBe(200);
  });
});

describe("dispatch assist flow", () => {
  const VOL = `${PREFIX}-volunteer`;
  let shopId = "";
  let flowTicket = "";

  it("seeds a volunteer and a tow shop", async () => {
    await seedUser(VOL, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "VOLUNTEER"]);
    const toggle = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(VOL))
      .send({available: true});
    expect(toggle.status).toBe(200);
    const shop = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Tow Co",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "TOW",
      });
    expect(shop.status).toBe(201);
    shopId = shop.body.data.id as string;
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
        destinationShopId: shopId,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.note).toBe("Alley gate");
    expect(res.body.data.destinationShopId).toBe(shopId);
    expect(res.body.data.destinationSnapshot.name).toBe("Tow Co");
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

  it("resolving restores tow availability", async () => {
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
    const shop = await request(app)
      .post("/shops")
      .set("Authorization", bearer(USER))
      .send({
        name: "Car Tow",
        lat: BASE_LAT,
        lng: BASE_LNG,
        type: "TOW",
        hasTow: true,
        towVehicleType: "CAR",
        towVehicleWidth: 1.9,
      });
    expect(shop.status).toBe(201);
    towId = shop.body.data.id as string;
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
