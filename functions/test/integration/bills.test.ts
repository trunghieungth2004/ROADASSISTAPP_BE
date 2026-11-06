import request from "supertest";
import {buildIntegrationApp} from "../utils/app";
import {STATUS_USER} from "../../constants/status";
import {
  cleanAll,
  seedUser,
  PREFIX,
  BASE_LAT,
  BASE_LNG,
  db,
} from "../utils/seed";

const app = buildIntegrationApp();
const bearer = (uid: string) => `Bearer ${uid}`;

const RIDER = `${PREFIX}-bill-rider`;
const TOWOP = `${PREFIX}-bill-towop`;
const SHOPOP = `${PREFIX}-bill-shopop`;
const ADMIN = `${PREFIX}-bill-admin`;
const OTHER = `${PREFIX}-bill-other`;
const VEHICLE = `${PREFIX}-bill-vehicle`;

type BillItem = {
  kind: string;
  ticketId: string;
  amount: number;
  waitingFee: number;
  status: string;
  payment: {
    method: string;
    status: string;
    commissionAmount?: number | null;
    payoutAmount?: number | null;
    payoutStatus?: string;
    canConfirmCash?: boolean;
  } | null;
};

type Bill = {
  billId: string;
  ticketId: string;
  total: number;
  paid: number;
  due: number;
  status: string;
  viewer: string;
  canPay: boolean;
  items: BillItem[];
};

let towShop = "";
let fixShop = "";
let towTicket = "";
let spawnedId = "";
let standaloneId = "";
let towAmount = 0;
const towFare = 200000;
const waitingFee = 10000;
const repairAmount = 150000;
const standaloneAmount = 90000;

beforeAll(async () => {
  await cleanAll();
  await seedUser(RIDER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(TOWOP, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(SHOPOP, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(ADMIN, "1", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await seedUser(OTHER, "2", STATUS_USER.ACTIVE, 0, ["RIDER"]);
  await db.collection("users").doc(RIDER).collection("vehicle_profiles")
    .doc(VEHICLE).set({
      id: VEHICLE,
      type: "BIKE",
      baseWidth: 0.7,
      baseHeight: 1.1,
      createdAt: new Date().toISOString(),
    });
});

afterAll(async () => {
  await cleanAll();
});

describe("bills", () => {
  it("seeds a tow and a drop-off shop", async () => {
    const tow = await request(app)
      .post("/providers")
      .set("Authorization", bearer(TOWOP))
      .send({
        kind: "TOW",
        name: "Bill Tow",
        lat: BASE_LAT,
        lng: BASE_LNG,
        plate: "30A-55555",
        vehicleType: "CAR",
        vehicleWidth: 2.0,
      });
    expect(tow.status).toBe(201);
    towShop = tow.body.data.id as string;
    const towReview = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: towShop, approve: true});
    expect(towReview.status).toBe(200);
    const shop = await request(app)
      .post("/providers")
      .set("Authorization", bearer(SHOPOP))
      .send({
        kind: "SHOP",
        name: "Bill Fix",
        lat: BASE_LAT,
        lng: BASE_LNG,
        vehicleClasses: ["SOLO_BIKE"],
      });
    expect(shop.status).toBe(201);
    fixShop = shop.body.data.id as string;
    const shopReview = await request(app)
      .post("/providers/review")
      .set("Authorization", bearer(ADMIN))
      .send({providerId: fixShop, approve: true});
    expect(shopReview.status).toBe(200);
  });

  it("resolves a tow to the drop-off shop", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(RIDER))
      .send({
        ticketType: "TOW",
        lat: BASE_LAT,
        lng: BASE_LNG,
        vehicleId: VEHICLE,
        destinationShopId: fixShop,
        vehicleType: "BIKE",
      });
    expect(opened.status).toBe(201);
    towTicket = opened.body.data.id as string;
    const select = await request(app)
      .post("/dispatch/select")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: towTicket, shopId: towShop});
    expect(select.status).toBe(200);
    const accept = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId: towTicket, shopId: towShop});
    expect(accept.status).toBe(200);
    const arrived = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId: towTicket, status: "3"});
    expect(arrived.status).toBe(200);
    const loaded = await request(app)
      .post("/dispatch/tow/loaded")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId: towTicket});
    expect(loaded.status).toBe(200);
    const resolved = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId: towTicket, status: "4"});
    expect(resolved.status).toBe(200);
    await db.collection("dispatch_tickets").doc(towTicket).update({
      towFare: {
        estimate: towFare,
        ceiling: towFare,
        final: towFare,
        waitingFee,
      },
    });
    const tow = await request(app)
      .post("/dispatch/one")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: towTicket});
    expect(tow.status).toBe(200);
    const fare = tow.body.data.towFare as {
      final?: number;
      waitingFee?: number;
    };
    expect(fare.final).toBe(towFare);
    towAmount = towFare + waitingFee;
    const feed = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(feed.status).toBe(200);
    const spawned = (
      feed.body.data as {
        id: string;
        ticketType: string;
        providerId?: string;
        linkedTicketIds?: string[];
      }[]
    ).find((t) =>
      t.ticketType === "WALK_IN" &&
      t.providerId === fixShop &&
      Array.isArray(t.linkedTicketIds) &&
      t.linkedTicketIds.includes(towTicket),
    );
    expect(spawned).toBeDefined();
    spawnedId = spawned?.id as string;
  });

  it("quotes the spawned walk-in", async () => {
    const accept = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(SHOPOP))
      .send({ticketId: spawnedId, shopId: fixShop});
    expect(accept.status).toBe(200);
    const quote = await request(app)
      .post("/dispatch/quote")
      .set("Authorization", bearer(SHOPOP))
      .send({
        ticketId: spawnedId,
        quotedAmount: repairAmount,
        workType: "Chain",
      });
    expect(quote.status).toBe(200);
  });

  it("lists one bill per ticket", async () => {
    const list = await request(app)
      .post("/bills/all")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(list.status).toBe(200);
    const bills = list.body.data as Bill[];
    expect(bills.map((b) => b.billId).sort()).toEqual(
      [towTicket, spawnedId].sort(),
    );
    const tow = bills.find((b) => b.billId === towTicket);
    expect(tow?.items).toHaveLength(1);
    expect(tow?.items[0]).toMatchObject({
      kind: "TOW_FARE",
      ticketId: towTicket,
      amount: towAmount,
      waitingFee,
      status: "UNPAID",
    });
    expect(tow?.total).toBe(towAmount);
    expect(tow?.due).toBe(towAmount);
    const repair = bills.find((b) => b.billId === spawnedId);
    expect(repair?.items).toHaveLength(1);
    expect(repair?.items[0]).toMatchObject({
      kind: "REPAIR",
      ticketId: spawnedId,
      amount: repairAmount,
      status: "UNPAID",
    });
    expect(repair?.total).toBe(repairAmount);
    const fromChild = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId});
    expect(fromChild.status).toBe(200);
    expect(fromChild.body.data.billId).toBe(spawnedId);
    const fromBill = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({billId: spawnedId});
    expect(fromBill.status).toBe(200);
    expect(fromBill.body.data.billId).toBe(spawnedId);
  });

  it("scopes each ticket to its payee", async () => {
    const shopOnTow = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(SHOPOP))
      .send({billId: towTicket});
    expect(shopOnTow.status).toBe(200);
    expect(shopOnTow.body.data).toMatchObject({
      viewer: "OPERATOR",
      canPay: false,
      total: towAmount,
    });
    const towPayee = await request(app)
      .post("/bills/payee")
      .set("Authorization", bearer(TOWOP))
      .send({});
    expect(towPayee.status).toBe(200);
    const towBills = towPayee.body.data as Bill[];
    expect(towBills).toHaveLength(1);
    expect(towBills[0]).toMatchObject({
      billId: towTicket,
      viewer: "PAYEE",
      canPay: false,
      total: towAmount,
    });
    expect(towBills[0].items).toHaveLength(1);
    expect(towBills[0].items[0]).toMatchObject({
      kind: "TOW_FARE",
      ticketId: towTicket,
      amount: towAmount,
    });
    const shopPayee = await request(app)
      .post("/bills/payee")
      .set("Authorization", bearer(SHOPOP))
      .send({});
    expect(shopPayee.status).toBe(200);
    const shopBills = shopPayee.body.data as Bill[];
    expect(shopBills).toHaveLength(1);
    expect(shopBills[0]).toMatchObject({
      billId: spawnedId,
      total: repairAmount,
    });
    expect(shopBills[0].items).toHaveLength(1);
    expect(shopBills[0].items[0]).toMatchObject({
      kind: "REPAIR",
      ticketId: spawnedId,
      amount: repairAmount,
    });
    const shopScoped = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(SHOPOP))
      .send({ticketId: spawnedId, scope: "payee"});
    expect(shopScoped.status).toBe(200);
    expect(shopScoped.body.data.billId).toBe(spawnedId);
    const towScoped = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId: towTicket, scope: "payee"});
    expect(towScoped.status).toBe(200);
    expect(towScoped.body.data.billId).toBe(towTicket);
    const riderScoped = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: towTicket, scope: "payee"});
    expect(riderScoped.status).toBe(403);
    const other = await request(app)
      .post("/bills/payee")
      .set("Authorization", bearer(OTHER))
      .send({});
    expect(other.status).toBe(200);
    expect(other.body.data).toEqual([]);
  });

  it("settles a ticket without touching the tow", async () => {
    const pay = await request(app)
      .post("/payments/create")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId, method: "CASH"});
    expect(pay.status).toBe(201);
    const feed = await request(app)
      .post("/dispatch/feed")
      .set("Authorization", bearer(SHOPOP))
      .send({});
    expect(feed.status).toBe(200);
    const shopRow = (feed.body.data as {id: string; canConfirmCash?: boolean}[])
      .find((row) => row.id === spawnedId);
    expect(shopRow?.canConfirmCash).toBe(true);
    const refused = await request(app)
      .post("/payments/confirm-cash")
      .set("Authorization", bearer(TOWOP))
      .send({ticketId: spawnedId});
    expect(refused.status).toBe(403);
    const confirm = await request(app)
      .post("/payments/confirm-cash")
      .set("Authorization", bearer(SHOPOP))
      .send({ticketId: spawnedId});
    expect(confirm.status).toBe(200);
    const approve = await request(app)
      .post("/dispatch/quote/approve")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId});
    expect(approve.status).toBe(200);
    const repair = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({billId: spawnedId});
    expect(repair.status).toBe(200);
    const repairBill = repair.body.data as Bill;
    expect(repairBill.items[0]).toMatchObject({
      status: "PAID",
      payment: {
        method: "CASH",
        status: "CONFIRMED",
        payoutStatus: "PENDING",
        canConfirmCash: false,
      },
    });
    expect(typeof repairBill.items[0].payment?.commissionAmount)
      .toBe("number");
    expect(typeof repairBill.items[0].payment?.payoutAmount).toBe("number");
    expect(repairBill.paid).toBe(repairAmount);
    expect(repairBill.due).toBe(0);
    expect(repairBill.status).toBe("PAID");
    const tow = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({billId: towTicket});
    expect(tow.status).toBe(200);
    const towBill = tow.body.data as Bill;
    expect(towBill.paid).toBe(0);
    expect(towBill.due).toBe(towAmount);
    expect(towBill.status).toBe("UNPAID");
    const payee = await request(app)
      .post("/bills/payee")
      .set("Authorization", bearer(SHOPOP))
      .send({});
    expect(payee.status).toBe(200);
    const payeeBills = payee.body.data as Bill[];
    expect(payeeBills).toHaveLength(1);
    expect(payeeBills[0].billId).toBe(spawnedId);
    expect(payeeBills[0].paid).toBe(repairAmount);
    expect(payeeBills[0].items[0].payment).toMatchObject({
      status: "CONFIRMED",
      payoutStatus: "PENDING",
    });
    const ready = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(SHOPOP))
      .send({ticketId: spawnedId, status: "7"});
    expect(ready.status).toBe(200);
    const done = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId, status: "4"});
    expect(done.status).toBe(200);
  });

  it("creates one invoice PDF for a paid ticket", async () => {
    const first = await request(app)
      .post("/bills/invoice")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId});
    expect(first.status).toBe(200);
    expect(first.body.data.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(first.body.data.invoiceId).toBe(spawnedId);
    expect(typeof first.body.data.url).toBe("string");
    const second = await request(app)
      .post("/bills/invoice")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId});
    expect(second.status).toBe(200);
    expect(second.body.data.number).toBe(first.body.data.number);
    const unpaid = await request(app)
      .post("/bills/invoice")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: towTicket});
    expect(unpaid.status).toBe(400);
  });

  it("keeps a standalone walk-in as its own bill", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(RIDER))
      .send({
        ticketType: "WALK_IN",
        lat: BASE_LAT,
        lng: BASE_LNG,
        providerId: fixShop,
        vehicleType: "BIKE",
      });
    expect(opened.status).toBe(201);
    standaloneId = opened.body.data.id as string;
    const accept = await request(app)
      .post("/dispatch/accept")
      .set("Authorization", bearer(SHOPOP))
      .send({ticketId: standaloneId, shopId: fixShop});
    expect(accept.status).toBe(200);
    const quote = await request(app)
      .post("/dispatch/quote")
      .set("Authorization", bearer(SHOPOP))
      .send({ticketId: standaloneId, quotedAmount: standaloneAmount});
    expect(quote.status).toBe(200);
    const list = await request(app)
      .post("/bills/all")
      .set("Authorization", bearer(RIDER))
      .send({});
    const bills = list.body.data as Bill[];
    expect(bills.map((b) => b.billId).sort()).toEqual(
      [towTicket, spawnedId, standaloneId].sort(),
    );
    const tow = bills.find((b) => b.billId === towTicket);
    expect(tow?.total).toBe(towAmount);
    const repair = bills.find((b) => b.billId === spawnedId);
    expect(repair?.paid).toBe(repairAmount);
    const standalone = bills.find((b) => b.billId === standaloneId);
    expect(standalone?.total).toBe(standaloneAmount);
    expect(standalone?.status).toBe("UNPAID");
    const payee = await request(app)
      .post("/bills/payee")
      .set("Authorization", bearer(SHOPOP))
      .send({});
    expect(payee.status).toBe(200);
    const payeeBills = payee.body.data as Bill[];
    expect(payeeBills.map((b) => b.billId).sort()).toEqual(
      [spawnedId, standaloneId].sort(),
    );
    const payeeStandalone = payeeBills.find((b) => b.billId === standaloneId);
    expect(payeeStandalone?.items).toHaveLength(1);
    expect(payeeStandalone?.total).toBe(standaloneAmount);
  });

  it("marks an armed SePay ticket as pending", async () => {
    const pay = await request(app)
      .post("/payments/create")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: towTicket, method: "SEPAY"});
    expect(pay.status).toBe(201);
    const bill = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({billId: towTicket});
    const data = bill.body.data as Bill;
    expect(data.items[0]).toMatchObject({
      status: "PENDING",
      payment: {method: "SEPAY", status: "PENDING"},
    });
    expect(data.paid).toBe(0);
    expect(data.due).toBe(towAmount);
    expect(data.status).toBe("UNPAID");
  });

  it("hides the bill from unrelated riders", async () => {
    const list = await request(app)
      .post("/bills/all")
      .set("Authorization", bearer(OTHER))
      .send({});
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    const one = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(OTHER))
      .send({billId: towTicket});
    expect(one.status).toBe(403);
  });

  it("needs a ticket or bill id", async () => {
    const res = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(res.status).toBe(400);
  });
});
