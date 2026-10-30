import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
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

const RIDER = `${PREFIX}-rider`;
const TOWOP = `${PREFIX}-towop`;
const TOW = `${PREFIX}-tow`;
const PROFILE = `${PREFIX}-vehicle`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(RIDER, "2");
  await seedUser(TOWOP, "2");
  await db.collection("users").doc(RIDER).collection("vehicle_profiles")
    .doc(PROFILE).set({
      id: PROFILE,
      type: "BIKE",
      baseWidth: 0.7,
      baseHeight: 1.1,
      createdAt: new Date().toISOString(),
    });
  await db.collection("providers").doc(TOW).set({
    id: TOW,
    kind: "TOW",
    name: "Tow Co",
    status: "ACTIVE",
    accepting: true,
    operatorUid: TOWOP,
    plate: "51A12345",
    lat: BASE_LAT,
    lng: BASE_LNG,
    createdAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  await cleanAll();
});

describe("ratings endpoints", () => {
  let ticketId = "";

  it("runs a TOW ticket to resolved", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(RIDER))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        vehicleId: PROFILE,
        vehicleType: "BIKE",
        vehicleWidth: 0.7,
        destinationPoint: {lat: 10.71, lng: 106.61, label: "Home"},
      });
    expect(opened.status).toBe(201);
    ticketId = opened.body.data.id as string;
    const accepted = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId, shopId: TOW});
    expect(accepted.status).toBe(200);
    const arrived = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(RIDER))
      .send({ticketId, status: "3"});
    expect(arrived.status).toBe(200);
    const resolved = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(RIDER))
      .send({ticketId, status: "4"});
    expect(resolved.status).toBe(200);
  });

  it("rejects ratings before resolve data exists", async () => {
    const res = await request(app)
      .post("/ratings")
      .set("Authorization", bearer(RIDER))
      .send({
        targetId: TOW,
        targetKind: "SHOP",
        ticketId: "ghost",
        score: 5,
      });
    expect(res.status).toBe(404);
  });

  it("POST /ratings records rider to helper", async () => {
    const res = await request(app)
      .post("/ratings")
      .set("Authorization", bearer(RIDER))
      .send({
        targetId: TOW,
        targetKind: "SHOP",
        ticketId,
        score: 5,
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({avg: 5, count: 1, updated: 1});
  });

  it("POST /ratings records helper to rider", async () => {
    const res = await request(app)
      .post("/ratings")
      .set("Authorization", bearer(TOWOP))
      .send({
        targetId: RIDER,
        targetKind: "RIDER",
        ticketId,
        score: 4,
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({avg: 4, count: 1, updated: 1});
  });

  it("POST /ratings rejects out-of-range scores", async () => {
    const res = await request(app)
      .post("/ratings")
      .set("Authorization", bearer(RIDER))
      .send({
        targetId: TOW,
        targetKind: "SHOP",
        ticketId,
        score: 9,
      });
    expect(res.status).toBe(400);
  });

  it("POST /ratings/by-ticket lists the ticket ratings", async () => {
    const res = await request(app)
      .post("/ratings/by-ticket")
      .set("Authorization", bearer(RIDER))
      .send({ticketId});
    expect(res.status).toBe(200);
    const scores = (res.body.data as {score: number}[]).map((r) => r.score);
    expect(scores).toContain(5);
    expect(scores).toContain(4);
  });

  it("POST /ratings/by-ticket rejects strangers", async () => {
    await seedUser(`${PREFIX}-bystander`, "2");
    const res = await request(app)
      .post("/ratings/by-ticket")
      .set("Authorization", bearer(`${PREFIX}-bystander`))
      .send({ticketId});
    expect(res.status).toBe(403);
  });
});
