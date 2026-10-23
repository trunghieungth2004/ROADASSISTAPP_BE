import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {cleanAll, seedUser, PREFIX, db} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const ADMIN = `${PREFIX}-rep-admin`;
const USER = `${PREFIX}-rep-user`;
const PAYEE = `${PREFIX}-rep-payee`;
const SHOP = `${PREFIX}-rep-shop`;

const seedPayment = async (
  patch: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("payments").doc();
  await ref.set({
    id: ref.id,
    ticketId: "t1",
    riderUid: USER,
    payeeId: PAYEE,
    amount: 100000,
    currency: "VND",
    method: "CASH",
    status: "CONFIRMED",
    qrRef: null,
    ipnRef: null,
    commissionRate: 10,
    commissionAmount: 10000,
    payoutAmount: 90000,
    confirmedBy: USER,
    confirmedAt: "2026-10-02T10:00:00.000Z",
    receiptUrl: null,
    refundAmount: null,
    refundedAt: null,
    refundedBy: null,
    payoutRef: null,
    payoutAt: null,
    payoutBy: null,
    payoutBatchId: null,
    createdAt: "2026-10-02T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    ...patch,
  });
  return ref.id;
};

const seedBatch = async (
  patch: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("payouts").doc();
  await ref.set({
    id: ref.id,
    payeeId: SHOP,
    payeeName: "Shop Two",
    gross: 50000,
    commission: 5000,
    refunded: 0,
    net: 45000,
    itemCount: 1,
    paymentIds: [],
    ticketIds: [],
    status: "PAID",
    payoutRef: "PO-1",
    payoutMethod: "MANUAL",
    note: null,
    batchedUid: ADMIN,
    batchedAt: "2026-10-05T10:00:00.000Z",
    createdAt: "2026-10-05T10:00:00.000Z",
    ...patch,
  });
  return ref.id;
};

beforeEach(async () => {
  await cleanAll();
  await seedUser(ADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(USER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(PAYEE, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(SHOP, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
});

afterAll(async () => {
  await cleanAll();
});

describe("notification preferences", () => {
  it("defaults to on and persists partial updates", async () => {
    const initial = await request(app)
      .post("/notifications/prefs")
      .set("Authorization", bearer(USER))
      .send({});
    expect(initial.status).toBe(200);
    expect(initial.body.data).toEqual({
      paymentUpdates: true,
      payoutUpdates: true,
    });
    const updated = await request(app)
      .put("/notifications/prefs")
      .set("Authorization", bearer(USER))
      .send({paymentUpdates: false});
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({
      paymentUpdates: false,
      payoutUpdates: true,
    });
    const stored = await db.collection("users").doc(USER).get();
    expect(stored.data()?.notificationPrefs).toEqual({
      paymentUpdates: false,
      payoutUpdates: true,
    });
    const reread = await request(app)
      .post("/notifications/prefs")
      .set("Authorization", bearer(USER))
      .send({});
    expect(reread.body.data.paymentUpdates).toBe(false);
  });

  it("requires at least one toggle on update", async () => {
    const empty = await request(app)
      .put("/notifications/prefs")
      .set("Authorization", bearer(USER))
      .send({});
    expect(empty.status).toBe(400);
  });
});

describe("admin reports", () => {
  beforeEach(async () => {
    await seedPayment({});
    await seedPayment({
      ticketId: "t2",
      payeeId: SHOP,
      amount: 50000,
      method: "SEPAY",
      status: "PARTIAL",
      commissionAmount: 5000,
      payoutAmount: 45000,
      refundAmount: 20000,
      payoutAt: "2026-10-05T10:00:00.000Z",
      payoutBatchId: "seed-batch",
      createdAt: "2026-10-03T10:00:00.000Z",
    });
    await seedPayment({
      ticketId: "t3",
      amount: 30000,
      status: "PENDING",
      createdAt: "2026-10-04T10:00:00.000Z",
    });
    await seedPayment({
      ticketId: "t4",
      amount: 70000,
      status: "CONFIRMED",
      createdAt: "2026-09-30T10:00:00.000Z",
    });
    await seedBatch({});
  });

  it("summarises revenue for the requested range", async () => {
    const res = await request(app)
      .post("/admin/reports/revenue")
      .set("Authorization", bearer(ADMIN))
      .send({from: "2026-10-01", to: "2026-10-31"});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      gross: 150000,
      refunds: 20000,
      commission: 13000,
      net: 117000,
      count: 2,
      currency: "VND",
    });
    expect(res.body.data.byMethod.CASH.net).toBe(90000);
    expect(res.body.data.byMethod.SEPAY.net).toBe(27000);
    expect(res.body.data.byDay).toHaveLength(2);
  });

  it("streams CSV with totals", async () => {
    const res = await request(app)
      .post("/admin/reports/revenue")
      .set("Authorization", bearer(ADMIN))
      .send({from: "2026-10-01", to: "2026-10-31", format: "csv"});
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("revenue-");
    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe("date,gross,refunds,commission,net,count");
    expect(lines[lines.length - 1])
      .toBe("TOTAL,150000,20000,13000,117000,2");
  });

  it("summarises payee earnings and settlement", async () => {
    const res = await request(app)
      .post("/admin/reports/payees")
      .set("Authorization", bearer(ADMIN))
      .send({from: "2026-10-01", to: "2026-10-31"});
    expect(res.status).toBe(200);
    const rows = res.body.data.rows as Array<Record<string, unknown>>;
    const mine = rows.find((row) => row.payeeId === PAYEE);
    expect(mine).toMatchObject({
      payeeName: `User ${PAYEE}`,
      gross: 100000,
      commission: 10000,
      net: 90000,
      pending: 90000,
      paid: 0,
      count: 1,
    });
    const shop = rows.find((row) => row.payeeId === SHOP);
    expect(shop).toMatchObject({
      payeeName: "Shop Two",
      gross: 50000,
      refunds: 20000,
      commission: 3000,
      net: 27000,
      pending: 0,
      paid: 45000,
      count: 1,
    });
  });

  it("streams the payee CSV", async () => {
    const res = await request(app)
      .post("/admin/reports/payees")
      .set("Authorization", bearer(ADMIN))
      .send({from: "2026-10-01", to: "2026-10-31", format: "csv"});
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      "payeeId,payeeName,gross,refunds,commission,net,paid,pending,count",
    );
    expect(res.text).toContain(
      `${SHOP},Shop Two,50000,20000,3000,27000,45000,0,1`,
    );
  });

  it("keeps reports admin-only and validates the range", async () => {
    const refused = await request(app)
      .post("/admin/reports/revenue")
      .set("Authorization", bearer(USER))
      .send({});
    expect(refused.status).toBe(403);
    const inverted = await request(app)
      .post("/admin/reports/revenue")
      .set("Authorization", bearer(ADMIN))
      .send({from: "2026-10-31", to: "2026-10-01"});
    expect(inverted.status).toBe(400);
  });
});
