import request from "supertest";
import {app} from "../../index";

const WEB_ORIGIN = "https://roadassistapp-c2e37.web.app";

describe("CORS preflight", () => {
  it("allows the web app origin on /users/me", async () => {
    const res = await request(app)
      .options("/users/me")
      .set("Origin", WEB_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows the web app origin on /places/saved", async () => {
    const res = await request(app)
      .options("/places/saved")
      .set("Origin", WEB_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
  });

  it("adds CORS headers to normal requests from the web app", async () => {
    const res = await request(app).get("/").set("Origin", WEB_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
  });

  it("allows project preview channels", async () => {
    const origin = "https://roadassistapp-c2e37--preview-abc123.web.app";
    const res = await request(app)
      .options("/users/me")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("allows local web development origins", async () => {
    const origin = "http://localhost:5173";
    const res = await request(app)
      .options("/users/me")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("reflects requested headers for allowed origins", async () => {
    const res = await request(app)
      .options("/users/me")
      .set("Origin", WEB_ORIGIN)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "authorization,x-custom-header");

    expect(res.status).toBe(204);
    expect(
      res.headers["access-control-allow-headers"],
    ).toContain("x-custom-header");
  });

  it("does not return 500 for an unknown origin", async () => {
    const res = await request(app)
      .options("/users/me")
      .set("Origin", "https://not-allowed.example")
      .set("Access-Control-Request-Method", "GET");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
