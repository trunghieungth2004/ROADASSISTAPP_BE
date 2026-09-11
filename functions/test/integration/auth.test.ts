import express, {Request, Response} from "express";
import request from "supertest";
import {auth, db} from "../../config/firebase";
import {
  requireAuth,
  requireRole,
  AuthedRequest,
} from "../../middleware/auth";
import {handleServiceError} from "../../utils/response";
import {cleanAll, seedUser, PREFIX} from "../utils/seed";

const app = express();
app.use(express.json());
app.post("/whoami", requireAuth, (req: Request, res: Response) => {
  const authed = req as AuthedRequest;
  res.status(200).json({
    statusCode: 200,
    status: "SUCCESS",
    data: {uid: authed.uid, role: authed.userRole},
  });
});
app.post("/admin", requireAuth, requireRole("1"), (_req, res) => {
  res.status(200).json({statusCode: 200, status: "SUCCESS", data: {ok: true}});
});
app.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    next: (e?: unknown) => void,
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    handleServiceError(res, err);
  },
);

const RIDER_EMAIL = `${PREFIX}-rider@example.com`;
const ADMIN_EMAIL = `${PREFIX}-admin@example.com`;
const OFF_EMAIL = `${PREFIX}-off@example.com`;
const PASSWORD = "secret123";

const mintToken = async (email: string): Promise<string> => {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
  const url =
    `http://${host}/identitytoolkit.googleapis.com/v1/` +
    "accounts:signInWithPassword?key=fake";
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({email, password: PASSWORD, returnSecureToken: true}),
  });
  const body = (await res.json()) as {idToken?: string};
  if (!body.idToken) throw new Error(`sign-in failed for ${email}`);
  return body.idToken;
};

let riderToken = "";
let adminToken = "";
let offToken = "";

beforeAll(async () => {
  await cleanAll();
  const rider = await auth.createUser({email: RIDER_EMAIL, password: PASSWORD});
  await seedUser(rider.uid, "2", "1");
  const admin = await auth.createUser({email: ADMIN_EMAIL, password: PASSWORD});
  await seedUser(admin.uid, "1", "1");
  const off = await auth.createUser({email: OFF_EMAIL, password: PASSWORD});
  await seedUser(off.uid, "2", "0");
  riderToken = await mintToken(RIDER_EMAIL);
  adminToken = await mintToken(ADMIN_EMAIL);
  offToken = await mintToken(OFF_EMAIL);
}, 60000);

afterAll(async () => {
  await cleanAll();
});

describe("token authentication", () => {
  it("rejects missing tokens with 401", async () => {
    const res = await request(app).post("/whoami").send({});
    expect(res.status).toBe(401);
  });

  it("rejects forged tokens with 401", async () => {
    const res = await request(app)
      .post("/whoami")
      .set("Authorization", "Bearer forged-token")
      .send({});
    expect(res.status).toBe(401);
  });

  it("rejects inactive users with 403", async () => {
    const res = await request(app)
      .post("/whoami")
      .set("Authorization", `Bearer ${offToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("authenticates a rider token and exposes uid plus role", async () => {
    const res = await request(app)
      .post("/whoami")
      .set("Authorization", `Bearer ${riderToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({role: "2"});
    expect(typeof res.body.data.uid).toBe("string");
  });

  it("forbids riders from admin routes with 403", async () => {
    const res = await request(app)
      .post("/admin")
      .set("Authorization", `Bearer ${riderToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("admits admins to admin routes", async () => {
    const res = await request(app)
      .post("/admin")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
  });

  it("auto-provisions user documents for new verified accounts", async () => {
    const fresh = await auth.createUser({
      email: `${PREFIX}-fresh@example.com`,
      password: PASSWORD,
    });
    const token = await mintToken(`${PREFIX}-fresh@example.com`);
    const res = await request(app)
      .post("/whoami")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({uid: fresh.uid, role: "2"});
    const probe = await db.collection("users").doc(fresh.uid).get();
    expect(probe.exists).toBe(true);
  });
});
