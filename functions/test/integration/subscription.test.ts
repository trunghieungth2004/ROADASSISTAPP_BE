import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {db, cleanAll, seedUser, PREFIX} from "../utils/seed";

process.env.SEPAY_SECRET_KEY = "integration-secret";
const app = buildIntegrationApp();
const RIDER = `${PREFIX}-sub-rider`;
const bearer = (uid: string) => `Bearer ${uid}`;

beforeAll(async () => {
  await cleanAll();
  await seedUser(RIDER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
});

afterAll(async () => {
  await cleanAll();
});

describe("VIP subscription payments", () => {
  it("creates a SePay plan charge and activates it on IPN", async () => {
    const before = await request(app)
      .post("/users/me")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(before.status).toBe(200);
    expect(before.body.data.subscription).toBeNull();
    expect(before.body.data.subscriptionPlans).toHaveLength(3);

    const created = await request(app)
      .post("/payments/create")
      .set("Authorization", bearer(RIDER))
      .send({planId: "MONTHLY", method: "SEPAY"});
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      amount: 200000,
      method: "SEPAY",
      status: "PENDING",
      purpose: "SUBSCRIPTION",
      subscriptionPlanId: "MONTHLY",
    });
    expect(created.body.data.checkout.qrUrl)
      .toContain("/payments/sepay/checkout/");

    const ipn = await request(app)
      .post("/payments/ipn")
      .set("Authorization", "Apikey integration-secret")
      .send({
        notification_type: "ORDER_PAID",
        order: {
          order_invoice_number: created.body.data.qrRef,
          order_amount: "200000",
        },
        transaction: {
          transaction_amount: "200000",
          transaction_id: "integration-tx",
        },
      });
    expect(ipn.status).toBe(200);
    expect(ipn.body.data.status).toBe("HELD");

    const after = await request(app)
      .post("/users/me")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(after.status).toBe(200);
    expect(after.body.data.subscription).toMatchObject({
      planId: "MONTHLY",
      status: "ACTIVE",
    });
    expect(Date.parse(after.body.data.subscription.expiresAt))
      .toBeGreaterThan(Date.now());

    const guard = await db
      .collection("payment_guards")
      .doc(created.body.data.ticketId)
      .get();
    expect(guard.exists).toBe(false);

    const renewed = await request(app)
      .post("/payments/create")
      .set("Authorization", bearer(RIDER))
      .send({planId: "MONTHLY", method: "SEPAY"});
    expect(renewed.status).toBe(201);
    expect(renewed.body.data.id).not.toBe(created.body.data.id);
  });

  it("rejects a request with both a ticket and a plan", async () => {
    const res = await request(app)
      .post("/payments/create")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: "tick1", planId: "MONTHLY", method: "SEPAY"});
    expect(res.status).toBe(400);
  });
});
