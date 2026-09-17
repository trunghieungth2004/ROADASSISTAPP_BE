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

const RIDER = `${PREFIX}-rider`;
const VOL = `${PREFIX}-volunteer`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(RIDER, "2");
  await seedUser(VOL, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "VOLUNTEER"]);
});

afterAll(async () => {
  await cleanAll();
});

describe("ratings endpoints", () => {
  let ticketId = "";

  it("runs an SOS ticket to resolved", async () => {
    const toggle = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(VOL))
      .send({available: true});
    expect(toggle.status).toBe(200);
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(RIDER))
      .send({ticketType: "SOS", lat: BASE_LAT, lng: BASE_LNG});
    expect(opened.status).toBe(201);
    ticketId = opened.body.data.id as string;
    const accepted = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(VOL))
      .send({ticketId});
    expect(accepted.status).toBe(200);
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
        targetId: VOL,
        targetKind: "VOLUNTEER",
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
        targetId: VOL,
        targetKind: "VOLUNTEER",
        ticketId,
        score: 5,
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({avg: 5, count: 1, updated: 1});
  });

  it("POST /ratings records helper to rider", async () => {
    const res = await request(app)
      .post("/ratings")
      .set("Authorization", bearer(VOL))
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
        targetId: VOL,
        targetKind: "VOLUNTEER",
        ticketId,
        score: 9,
      });
    expect(res.status).toBe(400);
  });
});
