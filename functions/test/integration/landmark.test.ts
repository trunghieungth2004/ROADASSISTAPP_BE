import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {
  cleanAll,
  seedUser,
  seedLandmark,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
} from "../utils/seed";

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

describe("landmark endpoints", () => {
  let landmarkId = "";

  it("POST /landmarks creates a landmark", async () => {
    const res = await request(app)
      .post("/landmarks")
      .set("Authorization", bearer(USER))
      .send({
        userId: USER,
        lat: BASE_LAT,
        lng: BASE_LNG,
        displayLabel: "Gate",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    landmarkId = res.body.data.id as string;
  });

  it("POST /landmarks/near returns distances", async () => {
    const res = await request(app)
      .post("/landmarks/near")
      .set("Authorization", bearer(USER))
      .send({userId: USER, lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(200);
    expect(res.body.data.map((l: {id: string}) => l.id)).toContain(landmarkId);
    for (const landmark of res.body.data as {distance: unknown}[]) {
      expect(typeof landmark.distance).toBe("number");
    }
  });

  it("POST /landmarks/match accepts above the threshold", async () => {
    const seeded = await seedLandmark({
      lat: BASE_LAT,
      lng: BASE_LNG,
      embedding: [1, 0],
    });
    const res = await request(app)
      .post("/landmarks/match")
      .set("Authorization", bearer(USER))
      .send({userId: USER, lat: BASE_LAT, lng: BASE_LNG, embedding: [1, 0]});
    expect(res.status).toBe(200);
    expect(res.body.data.landmark.id).toBe(seeded);
    expect(res.body.data.confidence).toBeCloseTo(1, 5);
  });

  it("POST /landmarks/match rejects below the threshold", async () => {
    const res = await request(app)
      .post("/landmarks/match")
      .set("Authorization", bearer(USER))
      .send({userId: USER, lat: BASE_LAT, lng: BASE_LNG, embedding: [0, 1]});
    expect(res.status).toBe(200);
    expect(res.body.data.landmark).toBeNull();
  });
});
