import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {cleanAll, seedUser, seedRole, PREFIX} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const USER = `${PREFIX}-user-1`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(USER, "2");
  await seedRole("1", "Admin", "Full access");
  await seedRole("2", "Rider", "Standard access");
});

afterAll(async () => {
  await cleanAll();
});

describe("role endpoints", () => {
  it("POST /roles/all lists the mapping", async () => {
    const res = await request(app)
      .post("/roles/all")
      .set("Authorization", bearer(USER))
      .send({userId: USER});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({id: "1", name: "Admin"}),
        expect.objectContaining({id: "2", name: "Rider"}),
      ]),
    );
  });

  it("POST /roles/user resolves the caller mapping", async () => {
    const res = await request(app)
      .post("/roles/user")
      .set("Authorization", bearer(USER))
      .send({userId: USER});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: USER,
      role: "2",
      name: "Rider",
    });
  });

  it("POST /roles/user returns 404 for an unknown bearer", async () => {
    const res = await request(app)
      .post("/roles/user")
      .set("Authorization", bearer(`${PREFIX}-ghost`))
      .send({userId: `${PREFIX}-ghost`});
    expect(res.status).toBe(404);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await request(app).post("/roles/all").send({userId: USER});
    expect(res.status).toBe(401);
  });
});
