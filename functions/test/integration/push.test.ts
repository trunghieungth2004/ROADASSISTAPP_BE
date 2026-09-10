import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  db,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-push-user`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
});

afterAll(async () => {
  await cleanAll();
  jest.restoreAllMocks();
});

describe("push endpoints", () => {
  it("POST /push/register stores and caps tokens", async () => {
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/push/register")
        .set("Authorization", bearer(USER))
        .send({token: `tok-${i}`, platform: "android"});
      expect(res.status).toBe(201);
    }
    const doc = await db.collection("fcm_tokens").doc(USER).get();
    expect(doc.data()?.tokens).toHaveLength(5);
    expect(doc.data()?.tokens).toContain("tok-5");
    expect(doc.data()?.tokens).not.toContain("tok-0");
    const again = await request(app)
      .post("/push/register")
      .set("Authorization", bearer(USER))
      .send({token: "tok-5"});
    expect(again.status).toBe(201);
    const doc2 = await db.collection("fcm_tokens").doc(USER).get();
    expect(doc2.data()?.tokens).toHaveLength(5);
  });

  it("POST /push/register rejects a missing token", async () => {
    const res = await request(app)
      .post("/push/register")
      .set("Authorization", bearer(USER))
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /push/unregister removes tokens", async () => {
    const removed = await request(app)
      .post("/push/unregister")
      .set("Authorization", bearer(USER))
      .send({token: "tok-5"});
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({removed: true});
    const missing = await request(app)
      .post("/push/unregister")
      .set("Authorization", bearer(USER))
      .send({token: "tok-5"});
    expect(missing.body.data).toEqual({removed: false});
    await db.collection("fcm_tokens").doc(USER).delete();
  });

  it("POST /push/deliver rejects callers without the queue header",
    async () => {
      const res = await request(app)
        .post("/push/deliver")
        .send({flagId: "flood-1"});
      expect(res.status).toBe(403);
    });

  it("POST /push/deliver skips when FCM is disabled", async () => {
    const res = await request(app)
      .post("/push/deliver")
      .set("X-CloudTasks-QueueName", "hazard-push")
      .send({flagId: "flood-1"});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({delivered: 0, skipped: true});
  });

  it("POST /routes records the active route for push matching", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{
          distance: 2450,
          duration: 512,
          geometry: {
            type: "LineString",
            coordinates: [[106.66, 10.76]],
          },
        }],
      }),
    } as unknown as Response);
    const res = await request(app)
      .post("/routes")
      .set("Authorization", bearer(USER))
      .send({
        originLat: BASE_LAT,
        originLng: BASE_LNG,
        destLat: 10.8,
        destLng: 106.71,
      });
    expect(res.status).toBe(200);
    jest.restoreAllMocks();
    const snapshot = await db.collection("active_routes").get();
    const mine = snapshot.docs
      .map((d) => d.data())
      .filter((r) => r.userId === USER);
    expect(mine).toHaveLength(1);
    expect(mine[0].geoCells.length).toBeGreaterThan(0);
    expect(mine[0].expiresAt).toBeDefined();
  });
});
