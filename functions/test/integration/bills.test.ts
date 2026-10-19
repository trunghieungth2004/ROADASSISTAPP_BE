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

type BillItem = {
  kind: string;
  ticketId: string;
  amount: number;
  waitingFee: number;
  status: string;
  payment: {method: string; status: string} | null;
};

type Bill = {
  billId: string;
  ticketId: string;
  total: number;
  paid: number;
  due: number;
  status: string;
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
        vehicleType: "VAN",
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
        destinationShopId: fixShop,
        vehicleType: "SCOOTER",
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
      .set("Authorization", bearer(RIDER))
      .send({ticketId: towTicket, status: "3"});
    expect(arrived.status).toBe(200);
    const resolved = await request(app)
      .put("/dispatch/status")
      .set("Authorization", bearer(RIDER))
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

  it("aggregates the journey into one bill", async () => {
    const list = await request(app)
      .post("/bills/all")
      .set("Authorization", bearer(RIDER))
      .send({});
    expect(list.status).toBe(200);
    const bills = list.body.data as Bill[];
    expect(bills).toHaveLength(1);
    const bill = bills[0];
    expect(bill.billId).toBe(towTicket);
    expect(bill.items).toHaveLength(2);
    expect(bill.items[0]).toMatchObject({
      kind: "TOW_FARE",
      ticketId: towTicket,
      amount: towAmount,
      waitingFee,
      status: "UNPAID",
    });
    expect(bill.items[1]).toMatchObject({
      kind: "REPAIR",
      ticketId: spawnedId,
      amount: repairAmount,
      status: "UNPAID",
    });
    expect(bill.total).toBe(towAmount + repairAmount);
    expect(bill.due).toBe(towAmount + repairAmount);
    expect(bill.status).toBe("UNPAID");
    const fromChild = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId});
    expect(fromChild.status).toBe(200);
    expect(fromChild.body.data.billId).toBe(towTicket);
    const fromBill = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({billId: towTicket});
    expect(fromBill.status).toBe(200);
    expect(fromBill.body.data.billId).toBe(towTicket);
  });

  it("settles one item without clearing the journey", async () => {
    const pay = await request(app)
      .post("/payments/create")
      .set("Authorization", bearer(RIDER))
      .send({ticketId: spawnedId, method: "CASH"});
    expect(pay.status).toBe(201);
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
    const bill = await request(app)
      .post("/bills/one")
      .set("Authorization", bearer(RIDER))
      .send({billId: towTicket});
    expect(bill.status).toBe(200);
    const data = bill.body.data as Bill;
    expect(data.items[1]).toMatchObject({
      status: "PAID",
      payment: {method: "CASH", status: "CONFIRMED"},
    });
    expect(data.paid).toBe(repairAmount);
    expect(data.due).toBe(towAmount);
    expect(data.status).toBe("PARTIAL");
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

  it("keeps a standalone walk-in as its own bill", async () => {
    const opened = await request(app)
      .post("/dispatch")
      .set("Authorization", bearer(RIDER))
      .send({
        ticketType: "WALK_IN",
        lat: BASE_LAT,
        lng: BASE_LNG,
        providerId: fixShop,
        vehicleType: "SCOOTER",
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
      [towTicket, standaloneId].sort(),
    );
    expect(bills.some((b) => b.billId === spawnedId)).toBe(false);
    const journey = bills.find((b) => b.billId === towTicket);
    expect(journey?.total).toBe(towAmount + repairAmount);
    expect(journey?.paid).toBe(repairAmount);
    expect(journey?.due).toBe(towAmount);
    const standalone = bills.find((b) => b.billId === standaloneId);
    expect(standalone?.total).toBe(standaloneAmount);
    expect(standalone?.status).toBe("UNPAID");
  });

  it("marks an armed SePay item as pending", async () => {
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
    expect(data.paid).toBe(repairAmount);
    expect(data.due).toBe(towAmount);
    expect(data.status).toBe("PARTIAL");
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
