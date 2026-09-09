import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {cleanAll, seedUser, seedStatus, PREFIX} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedStatus("users", "1", "Active", "Can authenticate", 1);
  await seedStatus("users", "0", "Inactive", "Blocked", 0);
  await seedStatus("flags", "1", "Suggested", "Awaiting votes", 1);
  await seedStatus("flags", "2", "Confirmed", "Reached consensus", 2);
  await seedStatus("dispatch", "1", "Pending", "Awaiting a match", 1);
});

afterAll(async () => {
  await cleanAll();
});

describe("status endpoints", () => {
  it("POST /statuses returns groups sorted by order", async () => {
    const res = await request(app)
      .post("/statuses")
      .set("Authorization", bearer(USER))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: "users:1", code: "1"}),
        expect.objectContaining({id: "users:0", code: "0"}),
      ]),
    );
    expect(res.body.data.flags).toMatchObject([
      {id: "flags:1", code: "1"},
      {id: "flags:2", code: "2"},
    ]);
    expect(res.body.data.dispatch).toMatchObject([
      {id: "dispatch:1", code: "1"},
    ]);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await request(app).post("/statuses").send({});
    expect(res.status).toBe(401);
  });
});
