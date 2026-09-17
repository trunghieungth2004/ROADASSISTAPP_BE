import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {db, cleanAll, seedUser, PREFIX} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const ADMIN = `${PREFIX}-admin`;
const RIDER = `${PREFIX}-rider`;
const TARGET = `${PREFIX}-target`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(ADMIN, "1");
  await seedUser(RIDER, "2", STATUS_USER.ACTIVE, 0, ["RIDER", "VOLUNTEER"]);
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
      phone: "+10000000001",
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
      phone: "+10000000002",
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

  it("PUT /users/profile renames the rider", async () => {
    const created = await request(app).post("/users/register").send({
      email: `${PREFIX}-rename@example.com`,
      password: "secret123",
      displayName: "Old Name",
      phone: "+10000000003",
    });
    const uid = created.body.data.uid as string;
    const res = await request(app)
      .put("/users/profile")
      .set("Authorization", bearer(uid))
      .send({displayName: "New Name"});
    expect(res.status).toBe(200);
    const doc = await db.collection("users").doc(uid).get();
    expect(doc.data()?.displayName).toBe("New Name");
  });
});

describe("volunteer endpoints", () => {
  it("PUT /users/volunteer opts in and out", async () => {
    const on = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(RIDER))
      .send({available: true});
    expect(on.status).toBe(200);
    expect(on.body.data).toEqual({updated: 1, available: true});
    let doc = await db.collection("users").doc(RIDER).get();
    expect(doc.data()?.volunteerAvailable).toBe(true);
    const off = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(RIDER))
      .send({available: false});
    expect(off.status).toBe(200);
    doc = await db.collection("users").doc(RIDER).get();
    expect(doc.data()?.volunteerAvailable).toBe(false);
  });

  it("heartbeat requires volunteer mode", async () => {
    const res = await request(app)
      .post("/users/volunteer/heartbeat")
      .set("Authorization", bearer(RIDER))
      .send({lat: 10.7626, lng: 106.6602});
    expect(res.status).toBe(400);
  });

  it("heartbeat records the volunteer location", async () => {
    await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(RIDER))
      .send({available: true});
    const res = await request(app)
      .post("/users/volunteer/heartbeat")
      .set("Authorization", bearer(RIDER))
      .send({lat: 10.7626, lng: 106.6602});
    expect(res.status).toBe(200);
    expect(res.body.data.uid).toBe(RIDER);
    await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(RIDER))
      .send({available: false});
  });
});

describe("volunteer capability", () => {
  it("PUT /users/volunteer stores the capability", async () => {
    const res = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(RIDER))
      .send({available: true, capability: "CAR"});
    expect(res.status).toBe(200);
    const doc = await db.collection("users").doc(RIDER).get();
    expect(doc.data()?.capability).toBe("CAR");
    await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(RIDER))
      .send({available: false});
  });
});

describe("service licenses", () => {
  it("PUT /users/volunteer rejects callers without the license", async () => {
    const res = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(TARGET))
      .send({available: true});
    expect(res.status).toBe(403);
  });

  it("PUT /users/services is admin-only", async () => {
    const res = await request(app)
      .put("/users/services")
      .set("Authorization", bearer(RIDER))
      .send({targetUserId: TARGET, grant: ["VOLUNTEER"]});
    expect(res.status).toBe(403);
  });

  it("admin grants and revokes licenses", async () => {
    const grant = await request(app)
      .put("/users/services")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: TARGET, grant: ["VOLUNTEER", "SHOP"]});
    expect(grant.status).toBe(200);
    expect(grant.body.data.services).toEqual(
      expect.arrayContaining(["RIDER", "VOLUNTEER", "SHOP"]),
    );
    const toggle = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(TARGET))
      .send({available: true});
    expect(toggle.status).toBe(200);
    const revoke = await request(app)
      .put("/users/services")
      .set("Authorization", bearer(ADMIN))
      .send({targetUserId: TARGET, revoke: ["VOLUNTEER"]});
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.services).not.toContain("VOLUNTEER");
    const denied = await request(app)
      .put("/users/volunteer")
      .set("Authorization", bearer(TARGET))
      .send({available: false});
    expect(denied.status).toBe(403);
  });

  it("PUT /users/onboard accepts the renamed service field", async () => {
    const res = await request(app)
      .put("/users/onboard")
      .set("Authorization", bearer(TARGET))
      .send({service: "TOW"});
    expect(res.status).toBe(200);
    const doc = await db.collection("users").doc(TARGET).get();
    expect(doc.data()?.services).toContain("TOW");
  });
});

describe("me and onboarding endpoints", () => {
  let profileId = "";

  it("POST /users/me returns vehicles and null active", async () => {
    const created = await request(app)
      .post("/vehicleProfiles")
      .set("Authorization", bearer(RIDER))
      .send({type: "SCOOTER", baseWidth: 0.7, baseHeight: 1.1});
    expect(created.status).toBe(201);
    profileId = created.body.data.id as string;
    const res = await request(app)
      .post("/users/me")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(RIDER);
    expect(res.body.data.user.onboarded).toBe(false);
    expect(res.body.data.vehicles.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.activeVehicle).toBeNull();
  });

  it("PUT /users/activeVehicle rejects a foreign profile", async () => {
    const res = await request(app)
      .put("/users/activeVehicle")
      .set("Authorization", bearer(TARGET))
      .send({profileId});
    expect(res.status).toBe(404);
  });

  it("PUT /users/activeVehicle persists and mirrors in /users/me", async () => {
    const set = await request(app)
      .put("/users/activeVehicle")
      .set("Authorization", bearer(RIDER))
      .send({profileId});
    expect(set.status).toBe(200);
    const me = await request(app)
      .post("/users/me")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(me.body.data.activeVehicle).toMatchObject({
      id: profileId,
      type: "SCOOTER",
    });
    const clear = await request(app)
      .put("/users/activeVehicle")
      .set("Authorization", bearer(RIDER))
      .send({profileId: null});
    expect(clear.status).toBe(200);
    const again = await request(app)
      .post("/users/me")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(again.body.data.activeVehicle).toBeNull();
  });

  it("PUT /users/onboard marks onboarded and stores services", async () => {
    const first = await request(app)
      .put("/users/onboard")
      .set("Authorization", bearer(RIDER))
      .send({role: "RIDER"});
    expect(first.status).toBe(200);
    expect(first.body.data.onboarded).toBe(true);
    const second = await request(app)
      .put("/users/onboard")
      .set("Authorization", bearer(RIDER))
      .send({role: "VOLUNTEER"});
    expect(second.status).toBe(200);
    const doc = await db.collection("users").doc(RIDER).get();
    expect(doc.data()?.onboarded).toBe(true);
    expect(doc.data()?.services).toEqual(
      expect.arrayContaining(["RIDER", "VOLUNTEER"]),
    );
  });

  it("PUT /users/onboard rejects unknown service roles", async () => {
    const res = await request(app)
      .put("/users/onboard")
      .set("Authorization", bearer(RIDER))
      .send({role: "ADMIN"});
    expect(res.status).toBe(400);
  });
});
