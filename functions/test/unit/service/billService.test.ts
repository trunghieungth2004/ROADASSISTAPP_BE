import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {billableAmountFor} from "../../../service/paymentService";
import {
  getBill,
  listBills,
  listPayeeBills,
} from "../../../service/billService";
import {STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");

type TicketPatch = Record<string, unknown>;

const ticket = (
  id: string,
  patch: TicketPatch = {},
): dispatchRepository.DispatchTicket => ({
  id,
  userId: "rider1",
  ticketType: "WALK_IN",
  status: STATUS_DISPATCH.MATCHED,
  lat: 10.7,
  lng: 106.6,
  createdAt: "2026-10-01T00:00:00.000Z",
  ...patch,
} as dispatchRepository.DispatchTicket);

const towTicket = (patch: TicketPatch = {}) =>
  ticket("tow1", {
    ticketType: "TOW",
    status: STATUS_DISPATCH.RESOLVED,
    assignedShopId: "tower1",
    towFare: {final: 200000, waitingFee: 20000},
    ...patch,
  });

const walkTicket = (patch: TicketPatch = {}) =>
  ticket("walk1", {
    providerId: "shop1",
    assignedShopId: "shop1",
    shopQuotedAmount: 150000,
    ...patch,
  });

const routeTickets = (...tickets: dispatchRepository.DispatchTicket[]) => {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  jest.mocked(dispatchRepository.findById).mockImplementation(
    async (id) => byId.get(id) ?? null,
  );
};

const routeProviders = (
  ...providers: {id: string; name: string; operatorUid?: string}[]
) => {
  const byId = new Map(providers.map((p) => [p.id, p]));
  jest.mocked(providerRepository.findById).mockImplementation(
    async (id) => (byId.get(id) ?? null) as never,
  );
};

const payment = (patch: Record<string, unknown> = {}) => ({
  id: "pay1",
  ticketId: "tow1",
  riderUid: "rider1",
  payeeId: "towerop1",
  amount: 220000,
  currency: "VND",
  method: "CASH",
  status: "CONFIRMED",
  qrRef: null,
  ipnRef: null,
  commissionRate: 10,
  commissionAmount: 22000,
  payoutAmount: 198000,
  confirmedBy: "towerop1",
  confirmedAt: "2026-10-01T01:00:00.000Z",
  receiptUrl: null,
  refundAmount: null,
  refundedAt: null,
  refundedBy: null,
  payoutRef: null,
  payoutAt: null,
  payoutBy: null,
  createdAt: "2026-10-01T00:30:00.000Z",
  updatedAt: "2026-10-01T01:00:00.000Z",
  ...patch,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(paymentRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(providerRepository.findById).mockResolvedValue(null);
  jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
  jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
  jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
  jest
    .mocked(userRepository.findById)
    .mockResolvedValue({id: "rider1", role: "2"} as never);
});

describe("billableAmountFor", () => {
  it("adds the waiting fee to the tow fare", () => {
    expect(billableAmountFor(towTicket() as never)).toEqual({
      amount: 220000,
      waitingFee: 20000,
    });
  });

  it("bills the tow estimate before the fare settles", () => {
    expect(
      billableAmountFor(towTicket({towFare: {estimate: 240000}}) as never),
    ).toEqual({amount: 240000, waitingFee: 0});
  });

  it("keeps the legacy tow final as a fallback only", () => {
    expect(
      billableAmountFor(
        towTicket({towFare: {final: 200000}, finalAmount: 999}) as never,
      ),
    ).toEqual({amount: 200000, waitingFee: 0});
    expect(
      billableAmountFor(
        towTicket({towFare: null, finalAmount: 180000}) as never,
      ),
    ).toEqual({amount: 180000, waitingFee: 0});
  });

  it("prefers the shop quote over the legacy final on a walk-in", () => {
    expect(
      billableAmountFor(walkTicket({finalAmount: 999}) as never),
    ).toEqual({amount: 150000, waitingFee: 0});
    expect(
      billableAmountFor(
        walkTicket({shopQuotedAmount: null, finalAmount: 120000}) as never,
      ),
    ).toEqual({amount: 120000, waitingFee: 0});
  });

  it("never bills an SOS ticket or a tow shop quote", () => {
    expect(
      billableAmountFor(ticket("sos1", {ticketType: "SOS"}) as never),
    ).toBeNull();
    expect(
      billableAmountFor(
        towTicket({towFare: null, finalAmount: null, shopQuotedAmount: 50000}),
      ),
    ).toBeNull();
  });
});

describe("billService.getBill", () => {
  it("builds one journey bill from its tickets", async () => {
    routeTickets(
      towTicket({linkedTicketIds: ["walk1"]}),
      walkTicket({
        linkedTicketIds: ["tow1"],
        status: STATUS_DISPATCH.QUOTED,
      }),
    );
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {id: "shop1", name: "Fix Shop", operatorUid: "shopop1"},
    );
    const bill = await getBill({userId: "rider1", ticketId: "walk1"});
    expect(bill.billId).toBe("tow1");
    expect(bill.items).toHaveLength(2);
    expect(bill.items[0]).toMatchObject({
      kind: "TOW_FARE",
      ticketId: "tow1",
      amount: 220000,
      waitingFee: 20000,
      status: "UNPAID",
      payeeName: "Tow Co",
    });
    expect(bill.items[1]).toMatchObject({
      kind: "REPAIR",
      ticketId: "walk1",
      amount: 150000,
      status: "UNPAID",
      payeeName: "Fix Shop",
    });
    expect(bill.total).toBe(370000);
    expect(bill.due).toBe(370000);
    expect(bill.status).toBe("UNPAID");
    expect(bill.viewer).toBe("RIDER");
    expect(bill.canPay).toBe(true);
  });

  it("reports a partially paid journey", async () => {
    routeTickets(
      towTicket({
        linkedTicketIds: ["walk1"],
        checkoutUrl: "https://pay.example/qr1",
      }),
      walkTicket({linkedTicketIds: ["tow1"], status: STATUS_DISPATCH.QUOTED}),
    );
    jest
      .mocked(paymentRepository.findByTicketId)
      .mockImplementation(async (ticketId) =>
        ticketId === "tow1" ? [payment() as never] : [],
      );
    const bill = await getBill({userId: "rider1", billId: "tow1"});
    expect(bill.items[0].status).toBe("PAID");
    expect(bill.items[0].qrUrl).toBe("https://pay.example/qr1");
    expect(bill.items[0].payment).toMatchObject({
      method: "CASH",
      status: "CONFIRMED",
      commissionAmount: 22000,
      payoutAmount: 198000,
      payoutStatus: "PENDING",
      canConfirmCash: false,
    });
    expect(bill.paid).toBe(220000);
    expect(bill.due).toBe(150000);
    expect(bill.status).toBe("PARTIAL");
  });

  it("voids the repair item when the walk-in is unfixable", async () => {
    routeTickets(
      towTicket({linkedTicketIds: ["walk1"]}),
      walkTicket({
        linkedTicketIds: ["tow1"],
        status: STATUS_DISPATCH.UNFIXABLE,
      }),
    );
    const bill = await getBill({userId: "rider1", ticketId: "tow1"});
    expect(bill.items[1].status).toBe("VOID");
    expect(bill.total).toBe(370000);
    expect(bill.due).toBe(220000);
    expect(bill.status).toBe("UNPAID");
  });

  it("shows a payee the whole journey without pay actions", async () => {
    routeTickets(
      towTicket({linkedTicketIds: ["walk1"]}),
      walkTicket({linkedTicketIds: ["tow1"]}),
    );
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {id: "shop1", name: "Fix Shop", operatorUid: "shopop1"},
    );
    jest
      .mocked(userRepository.findById)
      .mockResolvedValue({id: "shopop1", role: "2"} as never);
    const bill = await getBill({userId: "shopop1", ticketId: "walk1"});
    expect(bill.viewer).toBe("PAYEE");
    expect(bill.canPay).toBe(false);
    expect(bill.items).toHaveLength(2);
  });

  it("scopes a payee bill to the viewer's items", async () => {
    routeTickets(
      towTicket({linkedTicketIds: ["walk1"]}),
      walkTicket({linkedTicketIds: ["tow1"]}),
    );
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {id: "shop1", name: "Fix Shop", operatorUid: "shopop1"},
    );
    jest
      .mocked(userRepository.findById)
      .mockResolvedValue({id: "shopop1", role: "2"} as never);
    jest
      .mocked(paymentRepository.findByTicketId)
      .mockImplementation(async (ticketId) =>
        ticketId === "walk1" ?
          [payment({
            ticketId: "walk1",
            payeeId: "shopop1",
            amount: 150000,
            commissionAmount: 15000,
            payoutAmount: 135000,
            payoutAt: "2026-10-02T00:00:00.000Z",
          }) as never] :
          [],
      );
    const bill = await getBill({
      userId: "shopop1",
      ticketId: "walk1",
      scope: "payee",
    });
    expect(bill.viewer).toBe("PAYEE");
    expect(bill.canPay).toBe(false);
    expect(bill.items).toHaveLength(1);
    expect(bill.items[0]).toMatchObject({
      ticketId: "walk1",
      amount: 150000,
      status: "PAID",
      payment: {
        payoutStatus: "PAID",
        commissionAmount: 15000,
        payoutAmount: 135000,
      },
    });
    expect(bill.total).toBe(150000);
    expect(bill.paid).toBe(150000);
  });

  it("refuses a rider from using the payee scope", async () => {
    routeTickets(towTicket({linkedTicketIds: ["walk1"]}), walkTicket());
    await expect(
      getBill({userId: "rider1", ticketId: "tow1", scope: "payee"}),
    ).rejects.toThrow("Only the payee views a payee bill");
  });

  it("refuses a user who is not part of the journey", async () => {
    routeTickets(towTicket({linkedTicketIds: ["walk1"]}), walkTicket());
    jest
      .mocked(userRepository.findById)
      .mockResolvedValue({id: "other", role: "2"} as never);
    await expect(
      getBill({userId: "other", ticketId: "tow1"}),
    ).rejects.toThrow("Not allowed to view this bill");
  });

  it("lets an admin read any bill", async () => {
    routeTickets(towTicket({linkedTicketIds: ["walk1"]}), walkTicket());
    jest
      .mocked(userRepository.findById)
      .mockResolvedValue({id: "admin", role: ROLE_ADMIN} as never);
    const bill = await getBill({userId: "admin", ticketId: "tow1"});
    expect(bill.billId).toBe("tow1");
  });

  it("needs a ticket or bill id", async () => {
    await expect(getBill({userId: "rider1"})).rejects.toThrow(
      "ticketId or billId is required",
    );
  });
});

describe("billService.listBills", () => {
  it("lists journeys and standalone walk-ins once", async () => {
    const tow = towTicket({
      linkedTicketIds: ["walk1"],
      createdAt: "2026-10-03T00:00:00.000Z",
    });
    const spawned = walkTicket({
      linkedTicketIds: ["tow1"],
      status: STATUS_DISPATCH.QUOTED,
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const standalone = ticket("walk2", {
      providerId: "shop2",
      shopQuotedAmount: 90000,
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    const sos = ticket("sos1", {
      ticketType: "SOS",
      finalAmount: 70000,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    routeTickets(tow, spawned, standalone, sos);
    jest
      .mocked(dispatchRepository.findByUserId)
      .mockResolvedValue([spawned, standalone, sos, tow]);
    const bills = await listBills({userId: "rider1"});
    expect(bills.map((b) => b.billId)).toEqual(["tow1", "walk2"]);
    expect(bills[0].items).toHaveLength(2);
    expect(bills[1].items).toHaveLength(1);
  });

  it("lists an unfixable SOS call-out bill", async () => {
    const sos = ticket("sos1", {
      ticketType: "SOS",
      status: STATUS_DISPATCH.UNFIXABLE,
      assignedShopId: "mobile1",
      mobileCallOutFee: 50000,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    routeTickets(sos);
    routeProviders({id: "mobile1", name: "Mobile Shop", operatorUid: "op1"});
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([sos]);
    const bills = await listBills({userId: "rider1"});
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      billId: "sos1",
      ticketType: "SOS",
      total: 50000,
    });
  });

  it("skips a journey with nothing payable yet", async () => {
    const pendingTow = towTicket({towFare: null});
    routeTickets(pendingTow);
    jest
      .mocked(dispatchRepository.findByUserId)
      .mockResolvedValue([pendingTow]);
    await expect(listBills({userId: "rider1"})).resolves.toEqual([]);
  });

  it("caps the list", async () => {
    const first = towTicket({linkedTicketIds: []});
    const second = ticket("walk2", {
      providerId: "shop2",
      shopQuotedAmount: 90000,
    });
    routeTickets(first, second);
    jest
      .mocked(dispatchRepository.findByUserId)
      .mockResolvedValue([first, second]);
    const bills = await listBills({userId: "rider1", limit: 1});
    expect(bills).toHaveLength(1);
    expect(bills[0].billId).toBe("tow1");
  });
});

describe("billService.listPayeeBills", () => {
  it("lists the journey with only the shop's repair item", async () => {
    const tow = towTicket({linkedTicketIds: ["walk1"]});
    const spawned = walkTicket({linkedTicketIds: ["tow1"]});
    routeTickets(tow, spawned);
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {id: "shop1", name: "Fix Shop", operatorUid: "shopop1"},
    );
    jest
      .mocked(providerRepository.findByOperator)
      .mockResolvedValue([{id: "shop1", name: "Fix Shop"} as never]);
    jest
      .mocked(dispatchRepository.findRecentForShop)
      .mockResolvedValue([tow, spawned]);
    const bills = await listPayeeBills({userId: "shopop1"});
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      billId: "tow1",
      viewer: "PAYEE",
      canPay: false,
      total: 150000,
    });
    expect(bills[0].items).toHaveLength(1);
    expect(bills[0].items[0]).toMatchObject({
      ticketId: "walk1",
      amount: 150000,
      payeeName: "Fix Shop",
    });
  });

  it("keeps a tow payee to the fare item", async () => {
    const tow = towTicket({linkedTicketIds: ["walk1"]});
    const spawned = walkTicket({linkedTicketIds: ["tow1"]});
    routeTickets(tow, spawned);
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {id: "shop1", name: "Fix Shop", operatorUid: "shopop1"},
    );
    jest
      .mocked(providerRepository.findByOperator)
      .mockResolvedValue([{id: "tower1", name: "Tow Co"} as never]);
    jest
      .mocked(dispatchRepository.findRecentForShop)
      .mockResolvedValue([tow]);
    const bills = await listPayeeBills({userId: "towerop1"});
    expect(bills).toHaveLength(1);
    expect(bills[0].total).toBe(220000);
    expect(bills[0].items).toHaveLength(1);
    expect(bills[0].items[0]).toMatchObject({
      ticketId: "tow1",
      amount: 220000,
      payeeName: "Tow Co",
    });
  });
});
