import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {cleanAll, seedUser, PREFIX, db} from "../utils/seed";

process.env.SEPAY_SECRET_KEY = "test-secret";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const ADMIN = `${PREFIX}-pay-admin`;
const RIDER = `${PREFIX}-pay-rider`;
const PAYEE = `${PREFIX}-pay-payee`;
const OTHER = `${PREFIX}-pay-other`;
const NO_SERVICE = `${PREFIX}-pay-noservice`;

const makeTicket = async (
  patch: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("dispatch_tickets").doc();
  await ref.set({
    userId: RIDER,
    ticketType: "WALK_IN",
    status: "6",
    lat: 10.7626,
    lng: 106.6602,
    assignedUid: PAYEE,
    shopQuotedAmount: 100000,
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    ...patch,
  });
  return ref.id;
};

const paymentDoc = async (id: string) =>
  (await db.collection("payments").doc(id).get()).data() ?? {};

const ticketDoc = async (id: string) =>
  (await db.collection("dispatch_tickets").doc(id).get()).data() ?? {};

const create = (ticketId: string, method: string, uid = RIDER) =>
  request(app)
    .post("/payments/create")
    .set("Authorization", bearer(uid))
    .send({ticketId, method});

const ipn = (
  body: Record<string, unknown>,
  secret = "test-secret",
) =>
  request(app)
    .post("/payments/ipn")
    .set("Authorization", `Apikey ${secret}`)
    .send(body);

beforeEach(async () => {
  await cleanAll();
  await seedUser(ADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(RIDER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(PAYEE, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(OTHER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(NO_SERVICE, "2", STATUS_USER.ACTIVE, 0, []);
});

afterAll(async () => {
  await cleanAll();
});

describe("payment create", () => {
  it("reuses the active charge on retries and concurrent creates", async () => {
    const firstTicket = await makeTicket();
    const first = await create(firstTicket, "CASH");
    expect(first.status).toBe(201);
    expect(first.body.data.id).toBeDefined();
    const retry = await create(firstTicket, "CASH");
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(retry.body.data.reused).toBe(true);
    expect((await ticketDoc(firstTicket)).paymentId).toBe(first.body.data.id);
    const raceTicket = await makeTicket();
    const [left, right] = await Promise.all([
      create(raceTicket, "CASH"),
      create(raceTicket, "CASH"),
    ]);
    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(left.body.data.id).toBe(right.body.data.id);
    const snaps = await db
      .collection("payments")
      .where("ticketId", "==", raceTicket)
      .get();
    expect(snaps.size).toBe(1);
    const reused = [left, right]
      .filter((res) => res.body.data.reused === true);
    expect(reused).toHaveLength(1);
  });

  it("rejects a different method while a charge is active", async () => {
    const ticketId = await makeTicket();
    await create(ticketId, "CASH");
    const res = await create(ticketId, "SEPAY");
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("active payment");
    const snaps = await db
      .collection("payments")
      .where("ticketId", "==", ticketId)
      .get();
    expect(snaps.size).toBe(1);
  });

  it("requires the rider service to open a charge", async () => {
    const ticketId = await makeTicket({userId: NO_SERVICE});
    const res = await create(ticketId, "CASH", NO_SERVICE);
    expect(res.status).toBe(403);
  });
});

describe("cash confirmation", () => {
  it("lets only the payee or an admin confirm, once", async () => {
    const firstTicket = await makeTicket();
    const created = await create(firstTicket, "CASH");
    expect(created.status).toBe(201);
    const refused = await request(app)
      .post("/payments/confirm-cash")
      .set("Authorization", bearer(OTHER))
      .send({ticketId: firstTicket});
    expect(refused.status).toBe(403);
    const confirmed = await request(app)
      .post("/payments/confirm-cash")
      .set("Authorization", bearer(PAYEE))
      .send({ticketId: firstTicket});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("CONFIRMED");
    expect(confirmed.body.data.confirmedBy).toBe(PAYEE);
    const again = await request(app)
      .post("/payments/confirm-cash")
      .set("Authorization", bearer(PAYEE))
      .send({ticketId: firstTicket});
    expect(again.status).toBe(404);
    expect((await ticketDoc(firstTicket)).paymentStatus).toBe("CONFIRMED");
    const secondTicket = await makeTicket();
    await create(secondTicket, "CASH");
    const byAdmin = await request(app)
      .post("/payments/confirm-cash")
      .set("Authorization", bearer(ADMIN))
      .send({ticketId: secondTicket});
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.data.confirmedBy).toBe(ADMIN);
  });
});

describe("sepay IPN", () => {
  const openSepay = async () => {
    const ticketId = await makeTicket();
    const created = await create(ticketId, "SEPAY");
    expect(created.status).toBe(201);
    const doc = await paymentDoc(created.body.data.id);
    return {
      ticketId,
      paymentId: created.body.data.id,
      qrRef: String(doc.qrRef),
    };
  };

  it("rejects invalid or missing authorization", async () => {
    const {qrRef} = await openSepay();
    const invalid = await ipn({qrRef, amount: 100000}, "wrong");
    expect(invalid.status).toBe(403);
    const missing = await request(app)
      .post("/payments/ipn")
      .send({qrRef, amount: 100000});
    expect(missing.status).toBe(403);
  });

  it("rejects missing and mismatched amounts", async () => {
    const {paymentId, qrRef} = await openSepay();
    const missing = await ipn({qrRef});
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain("amount missing");
    const wrong = await ipn({qrRef, amount: 1});
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toContain("mismatch");
    expect((await paymentDoc(paymentId)).status).toBe("PENDING");
  });

  it("holds the charge once and stamps the ticket", async () => {
    const {ticketId, paymentId, qrRef} = await openSepay();
    const held = await ipn({qrRef, amount: 100000, transaction_id: "TX-1"});
    expect(held.status).toBe(200);
    expect(held.body.data.status).toBe("HELD");
    expect(held.body.data.ipnRef).toBe("TX-1");
    const stamped = await ticketDoc(ticketId);
    expect(stamped.paymentStatus).toBe("HELD");
    expect(stamped.paymentId).toBe(paymentId);
    const replay = await ipn({qrRef, amount: 100000, transaction_id: "TX-1"});
    expect(replay.status).toBe(200);
    expect(replay.body.data.status).toBe("HELD");
  });

  it("rejects IPNs for refunded and cancelled charges", async () => {
    const {paymentId, qrRef} = await openSepay();
    await db.collection("payments").doc(paymentId)
      .update({status: "REFUNDED"});
    const refunded = await ipn({qrRef, amount: 100000});
    expect(refunded.status).toBe(400);
    expect(refunded.body.message).toContain("cannot be held");
    await db.collection("payments").doc(paymentId)
      .update({status: "CANCELLED"});
    const cancelled = await ipn({qrRef, amount: 100000});
    expect(cancelled.status).toBe(400);
    expect(cancelled.body.message).toContain("cannot be held");
  });
});

describe("ledger audit", () => {
  it("reports ticket stamp drift to admins only", async () => {
    const ticketId = await makeTicket();
    const created = await create(ticketId, "CASH");
    const paymentId = created.body.data.id;
    await db.collection("payments").doc(paymentId)
      .update({status: "CONFIRMED"});
    const refused = await request(app)
      .post("/admin/payments/audit")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(refused.status).toBe(403);
    const audit = await request(app)
      .post("/admin/payments/audit")
      .set("Authorization", bearer(ADMIN))
      .send({limit: 50});
    expect(audit.status).toBe(200);
    expect(audit.body.data.scanned).toBe(1);
    expect(audit.body.data.tickets).toBe(1);
    expect(audit.body.data.drift).toEqual([{
      ticketId,
      paymentId,
      expected: "CONFIRMED",
      actual: "PENDING",
    }]);
  });
});
