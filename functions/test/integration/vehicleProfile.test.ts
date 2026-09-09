import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {cleanAll, seedUser, PREFIX} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
});

afterAll(async () => {
  await cleanAll();
});

describe("vehicle profile endpoints", () => {
  let profileId = "";

  it("POST /vehicleProfiles creates a profile", async () => {
    const res = await request(app)
      .post("/vehicleProfiles")
      .set("Authorization", bearer(USER))
      .send({userId: USER, type: "SCOOTER", baseWidth: 0.7, baseHeight: 1.1});
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    profileId = res.body.data.id as string;
  });

  it("POST /vehicleProfiles/all lists the profiles", async () => {
    const res = await request(app)
      .post("/vehicleProfiles/all")
      .set("Authorization", bearer(USER))
      .send({userId: USER});
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: {id: string}) => p.id)).toContain(profileId);
  });

  it("POST /vehicleProfiles/rideConfig attaches a config", async () => {
    const res = await request(app)
      .post("/vehicleProfiles/rideConfig")
      .set("Authorization", bearer(USER))
      .send({userId: USER, profileId, configType: "CARGO", estWidth: 0.9});
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
  });

  it("POST /vehicleProfiles/rideConfig 404s unknown profiles", async () => {
    const res = await request(app)
      .post("/vehicleProfiles/rideConfig")
      .set("Authorization", bearer(USER))
      .send({userId: USER, profileId: "ghost", configType: "SOLO"});
    expect(res.status).toBe(404);
  });
});
