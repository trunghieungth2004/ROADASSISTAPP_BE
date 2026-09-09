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
