import request from "supertest";
import {app} from "../../../index";

const WEB_ORIGIN = "https://roadassistapp-c2e37.web.app";

describe("CORS without a configured allowlist", () => {
  it("answers a web preflight instead of returning 500", async () => {
    const res = await request(app)
      .options("/users/me")
      .set("Origin", WEB_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("still serves requests without an Origin (mobile clients)", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
  });
});
