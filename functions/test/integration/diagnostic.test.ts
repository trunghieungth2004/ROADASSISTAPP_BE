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

describe("diagnostic endpoints", () => {
  let diagnosticId = "";

  it("POST /diagnostics records a diagnostic", async () => {
    const res = await request(app)
      .post("/diagnostics")
      .set("Authorization", bearer(USER))
      .send({userId: USER, category: "FLAT_TIRE", imagePath: "d/1.jpg"});
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    diagnosticId = res.body.data.id as string;
  });

  it("POST /diagnostics/one reads the diagnostic", async () => {
    const res = await request(app)
      .post("/diagnostics/one")
      .set("Authorization", bearer(USER))
      .send({userId: USER, diagnosticId});
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(diagnosticId);
  });

  it("POST /diagnostics/one returns 404 for unknown ids", async () => {
    const res = await request(app)
      .post("/diagnostics/one")
      .set("Authorization", bearer(USER))
      .send({userId: USER, diagnosticId: "ghost"});
    expect(res.status).toBe(404);
  });
});
