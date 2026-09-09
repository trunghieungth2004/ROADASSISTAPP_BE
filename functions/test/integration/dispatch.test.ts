import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
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

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
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
      .send({userId: USER, ticketType: "TOW", lat: BASE_LAT, lng: BASE_LNG});
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING");
    ticketId = res.body.data.id as string;
  });

  it("POST /dispatch/one reads the ticket", async () => {
    const res = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(USER))
      .send({userId: USER, ticketId});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ticketId);
  });

  it("PUT /dispatch/status advances the ticket", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({userId: USER, ticketId, status: "MATCHED"});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({updated: 1});
  });

  it("PUT /dispatch/status rejects illegal statuses with 400", async () => {
    const res = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(USER))
      .send({userId: USER, ticketId, status: "FLYING"});
    expect(res.status).toBe(400);
  });
});
