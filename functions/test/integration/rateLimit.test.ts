import request from "supertest";
import {app} from "../../index";

describe("rate limits", () => {
  beforeAll(() => {
    process.env.WRITE_LIMIT_DISABLED = "false";
  });

  it("does not spend the write budget on polling reads", async () => {
    for (let i = 0; i < 35; i += 1) {
      const res = await request(app).post("/dispatch/feed").send({});
      expect(res.status).not.toBe(429);
    }
  });

  it("limits mutating routes", async () => {
    let status = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await request(app).post("/dispatch/accept").send({});
      status = res.status;
    }
    expect(status).toBe(429);
  });
});
