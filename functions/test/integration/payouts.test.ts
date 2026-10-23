import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {cleanAll, seedUser, PREFIX, db} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const ADMIN = `${PREFIX}-payout-admin`;
const PAYEE = `${PREFIX}-payout-shop`;
const OTHER = `${PREFIX}-payout-other`;
const RIDER = `${PREFIX}-payout-rider`;

const seedPayment = async (
  patch: Record<string, unknown> = {},
): Promise<string> => {
  const ref = db.collection("payments").doc();
  const now = new Date().toISOString();
  await ref.set({
    id: ref.id,
    ticketId: "t1",
    riderUid: RIDER,
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
    confirmedBy: null,
    confirmedAt: null,
    receiptUrl: null,
    refundAmount: null,
    refundedAt: null,
    refundedBy: null,
    payoutRef: null,
    payoutAt: null,
    payoutBy: null,
    payoutBatchId: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  });
  return ref.id;
};

const paymentDoc = async (id: string) =>
  (await db.collection("payments").doc(id).get()).data() ?? {};

beforeEach(async () => {
  await cleanAll();
  await seedUser(ADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(PAYEE, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(OTHER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(RIDER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
});

afterAll(async () => {
  await cleanAll();
});

describe("payout settlement", () => {
  it("settles a payee's received payments into one batch", async () => {
    const first = await seedPayment({});
    await seedPayment({
      ticketId: "t2",
      status: "HELD",
      commissionAmount: null,
      payoutAmount: null,
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    const pending = await request(app)
      .post("/admin/payouts/pending")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0]).toMatchObject({
      payeeId: PAYEE,
      gross: 200000,
      commission: 10000,
      net: 190000,
      itemCount: 2,
    });
    const settle = await request(app)
      .post("/admin/payouts/batch")
      .set("Authorization", bearer(ADMIN))
      .send({payeeId: PAYEE, note: "bank transfer"});
    expect(settle.status).toBe(200);
    expect(settle.body.data.settled).toBe(2);
    const batch = settle.body.data.batch;
    expect(batch.net).toBe(190000);
    expect(batch.payoutRef).toMatch(/^PO/);
    expect(batch.note).toBe("bank transfer");
    const stamped = await paymentDoc(first);
    expect(stamped.payoutBatchId).toBe(batch.id);
    expect(stamped.payoutBy).toBe(ADMIN);
    expect(typeof stamped.payoutAt).toBe("string");
    const drained = await request(app)
      .post("/admin/payouts/pending")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(drained.body.data).toEqual([]);
  });

  it("shows the payee the settled batch and outstanding totals", async () => {
    await seedPayment({});
    const before = await request(app)
      .post("/payouts/mine")
      .set("Authorization", bearer(PAYEE))
      .send({});
    expect(before.status).toBe(200);
    expect(before.body.data.pending).toMatchObject({net: 90000});
    expect(before.body.data.batches).toEqual([]);
    await request(app)
      .post("/admin/payouts/batch")
      .set("Authorization", bearer(ADMIN))
      .send({payeeId: PAYEE});
    const after = await request(app)
      .post("/payouts/mine")
      .set("Authorization", bearer(PAYEE))
      .send({});
    expect(after.body.data.batches).toHaveLength(1);
    expect(after.body.data.batches[0].net).toBe(90000);
    expect(after.body.data.pending).toMatchObject({net: 0, itemCount: 0});
    expect(after.body.data.settled).toMatchObject({
      gross: 100000,
      commission: 10000,
      net: 90000,
      itemCount: 1,
    });
  });

  it("skips refunded and already-stamped payments", async () => {
    await seedPayment({status: "REFUNDED"});
    await seedPayment({payoutAt: "2026-10-01T00:00:00.000Z"});
    const pending = await request(app)
      .post("/admin/payouts/pending")
      .set("Authorization", bearer(ADMIN))
      .send({});
    expect(pending.body.data).toEqual([]);
    const settle = await request(app)
      .post("/admin/payouts/batch")
      .set("Authorization", bearer(ADMIN))
      .send({payeeId: PAYEE});
    expect(settle.status).toBe(400);
  });

  it("rejects a batch that mixes in another payee's payment", async () => {
    const mine = await seedPayment({});
    const foreign = await seedPayment({payeeId: OTHER});
    const res = await request(app)
      .post("/admin/payouts/batch")
      .set("Authorization", bearer(ADMIN))
      .send({payeeId: PAYEE, paymentIds: [mine, foreign]});
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("another payee");
    expect((await paymentDoc(mine)).payoutBatchId).toBeNull();
  });

  it("keeps settlement endpoints admin-only", async () => {
    await seedPayment({});
    const pending = await request(app)
      .post("/admin/payouts/pending")
      .set("Authorization", bearer(PAYEE))
      .send({});
    expect(pending.status).toBe(403);
    const settle = await request(app)
      .post("/admin/payouts/batch")
      .set("Authorization", bearer(RIDER))
      .send({payeeId: PAYEE});
    expect(settle.status).toBe(403);
    const history = await request(app)
      .post("/admin/payouts/batches")
      .set("Authorization", bearer(PAYEE))
      .send({});
    expect(history.status).toBe(403);
  });

  it("does not leak another payee's batches", async () => {
    await seedPayment({});
    await request(app)
      .post("/admin/payouts/batch")
      .set("Authorization", bearer(ADMIN))
      .send({payeeId: PAYEE});
    const mine = await request(app)
      .post("/payouts/mine")
      .set("Authorization", bearer(OTHER))
      .send({});
    expect(mine.status).toBe(200);
    expect(mine.body.data.batches).toEqual([]);
    expect(mine.body.data.settled.net).toBe(0);
  });
});
