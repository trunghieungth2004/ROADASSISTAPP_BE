import {Timestamp} from "firebase-admin/firestore";
import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  seedFlag,
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
  await seedUser(USER, "2");
  await seedUser(ADMIN, "1");
});

afterAll(async () => {
  await cleanAll();
});

describe("flag endpoints", () => {
  let flagId = "";

  it("POST /flags submits a suggested flag", async () => {
    const res = await request(app)
      .post("/flags")
      .set("Authorization", bearer(USER))
      .send({type: "FLOOD", lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("1");
    flagId = res.body.data.id as string;
  });

  it("POST /flags/confirm flips to confirmed at three votes", async () => {
    await request(app)
      .post("/flags/confirm")
      .set("Authorization", bearer(USER))
      .send({flagId});
    await request(app)
      .post("/flags/confirm")
      .set("Authorization", bearer(USER))
      .send({flagId});
    const third = await request(app)
      .post("/flags/confirm")
      .set("Authorization", bearer(USER))
      .send({flagId});
    expect(third.status).toBe(200);
    expect(third.body.data).toMatchObject({
      voteCount: 3,
      status: "2",
    });
  });

  it("POST /flags/near excludes expired flags", async () => {
    await seedFlag({lat: BASE_LAT, lng: BASE_LNG, status: "4"});
    const res = await request(app)
      .post("/flags/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    const ids = res.body.data.map((f: {id: string}) => f.id);
    expect(ids).toContain(flagId);
    for (const flag of res.body.data as {status: string}[]) {
      expect(["1", "2", "3"]).toContain(flag.status);
    }
  });

  it("PUT /flags/moderate locks as admin", async () => {
    const res = await request(app)
      .put("/flags/moderate")
      .set("Authorization", bearer(ADMIN))
      .send({flagId, status: "3"});
    expect(res.status).toBe(200);
  });

  it("POST /flags/expire flips lapsed flags", async () => {
    await seedFlag({
      lat: BASE_LAT,
      lng: BASE_LNG,
      ttlExpiresAt: Timestamp.fromDate(new Date(Date.now() - 1000)),
    });
    const res = await request(app)
      .post("/flags/expire")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.expired).toBeGreaterThanOrEqual(1);
  });
});

describe("flag unflag", () => {
  it("POST /flags accepts an optional radiusMeters", async () => {
    const res = await request(app)
      .post("/flags")
      .set("Authorization", bearer(USER))
      .send({type: "FLOOD", lat: BASE_LAT, lng: BASE_LNG, radiusMeters: 500});
    expect(res.status).toBe(201);
    expect(res.body.data.radiusMeters).toBe(500);
  });

  it("POST /flags/unflag returns 404 for unknown flags", async () => {
    const res = await request(app)
      .post("/flags/unflag")
      .set("Authorization", bearer(USER))
      .send({flagId: "nope"});
    expect(res.status).toBe(404);
  });

  it("POST /flags/unflag enforces reporter-only removal", async () => {
    const created = await request(app)
      .post("/flags")
      .set("Authorization", bearer(USER))
      .send({type: "ACCIDENT", lat: BASE_LAT, lng: BASE_LNG});
    const id = created.body.data.id as string;
    const forbidden = await request(app)
      .post("/flags/unflag")
      .set("Authorization", bearer(ADMIN))
      .send({flagId: id});
    expect(forbidden.status).toBe(403);
    const removed = await request(app)
      .post("/flags/unflag")
      .set("Authorization", bearer(USER))
      .send({flagId: id});
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({unflagged: 1});
    const near = await request(app)
      .post("/flags/near")
      .set("Authorization", bearer(USER))
      .send({lat: BASE_LAT, lng: BASE_LNG});
    const ids = (near.body.data as {id: string}[]).map((f) => f.id);
    expect(ids).not.toContain(id);
  });

  it("POST /flags/unflag refuses locked flags with 400", async () => {
    const locked = await seedFlag({
      type: "FLOOD",
      status: "3",
      lat: BASE_LAT,
      lng: BASE_LNG,
    });
    const res = await request(app)
      .post("/flags/unflag")
      .set("Authorization", bearer(USER))
      .send({flagId: locked});
    expect(res.status).toBe(400);
  });
});
