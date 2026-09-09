import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {db, cleanAll, seedUser, PREFIX} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const ADMIN = `${PREFIX}-admin`;
const RIDER = `${PREFIX}-rider`;
const TARGET = `${PREFIX}-target`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(ADMIN, "1");
  await seedUser(RIDER, "2");
  await seedUser(TARGET, "2");
});

afterAll(async () => {
  await cleanAll();
});

describe("user endpoints", () => {
  it("POST /users/register creates an active rider", async () => {
    const res = await request(app).post("/users/register").send({
      email: `${PREFIX}-new@example.com`,
      password: "secret123",
      displayName: "New Rider",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.uid).toBeDefined();
    const doc = await db.collection("users").doc(res.body.data.uid).get();
    expect(doc.data()).toMatchObject({
      role: "2",
      status: "1",
      trustScore: 0,
    });
  });

  it("POST /users/one returns the user", async () => {
    const res = await request(app)
      .post("/users/one")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(RIDER);
    expect(res.body.data.role).toBe("2");
  });

  it("POST /users/one returns 404 for an unknown bearer", async () => {
    const res = await request(app)
      .post("/users/one")
      .set("Authorization", bearer(`${PREFIX}-ghost`))
      .send({});
    expect(res.status).toBe(404);
  });

  it("POST /users/all lists users for admins", async () => {
    const res = await request(app)
      .post("/users/all")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
  });

  it("PUT /users/role changes the target role", async () => {
    const res = await request(app)
      .put("/users/role")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: TARGET, role: "1"});
    expect(res.status).toBe(200);
    const doc = await db.collection("users").doc(TARGET).get();
    expect(doc.data()?.role).toBe("1");
    await request(app)
      .put("/users/role")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: TARGET, role: "2"});
  });

  it("PUT /users/role blocks self changes with 400", async () => {
    const res = await request(app)
      .put("/users/role")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: ADMIN, role: "2"});
    expect(res.status).toBe(400);
  });

  it("PUT /users/trust writes the score", async () => {
    const res = await request(app)
      .put("/users/trust")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: TARGET, trustScore: 60});
    expect(res.status).toBe(200);
    const doc = await db.collection("users").doc(TARGET).get();
    expect(doc.data()?.trustScore).toBe(60);
  });

  it("PUT /users/status deactivates and reactivates", async () => {
    const created = await request(app).post("/users/register").send({
      email: `${PREFIX}-toggle@example.com`,
      password: "secret123",
    });
    const uid = created.body.data.uid as string;
    const off = await request(app)
      .put("/users/status")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: uid, status: "0"});
    expect(off.status).toBe(200);
    const doc = await db.collection("users").doc(uid).get();
    expect(doc.data()?.status).toBe("0");
    const on = await request(app)
      .put("/users/status")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: uid, status: "1"});
    expect(on.status).toBe(200);
  });
});
