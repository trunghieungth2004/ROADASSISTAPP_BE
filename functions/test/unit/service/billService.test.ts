import * as dispatchRepository from
  "../../../repository/dispatchRepository";
import * as paymentRepository from "../../../repository/paymentRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import * as refundRepository from "../../../repository/refundRepository";
import * as disputeRepository from "../../../repository/disputeRepository";
import {billableAmountFor} from "../../../service/paymentService";
import {
  getBill,
  listBills,
  listPayeeBills,
} from "../../../service/billService";
import {breakdownFor} from "../../../service/bill/breakdown";
import {STATUS_DISPATCH} from "../../../constants/status";
import {ROLE_ADMIN} from "../../../constants/roles";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/refundRepository");
jest.mock("../../../repository/disputeRepository");

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
  ...providers: {
    id: string;
    name: string;
    label?: string;
    lat?: number;
    lng?: number;
    kind?: string;
    operatorUid?: string;
  }[]
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
  jest.mocked(refundRepository.findByPaymentId).mockResolvedValue([]);
  jest.mocked(disputeRepository.findByTicketId).mockResolvedValue([]);
  jest.mocked(providerRepository.findById).mockResolvedValue(null);
  jest.mocked(providerRepository.findByOperator).mockResolvedValue([]);
  jest.mocked(dispatchRepository.findRecentForShop).mockResolvedValue([]);
  jest.mocked(dispatchRepository.findByAssignee).mockResolvedValue([]);
  jest
    .mocked(userRepository.findById)
    .mockResolvedValue({id: "rider1", role: "2"} as never);
});

describe("tow breakdown adjustments", () => {
  it("labels a real ceiling as the cap", () => {
    const ticket = towTicket({
      towFare: {
        final: 550000,
        waitingFee: 0,
        baseFee: 500000,
        perKmFee: 25000,
        includedKm: 10,
        billableKm: 4,
        ceiling: 550000,
        night: false,
      },
    });
    const {breakdown} = breakdownFor(ticket, 550000);
    expect(breakdown).toContainEqual({
      code: "CEILING",
      label: "Fare cap",
      amount: -50000,
      detail: "capped at 550000",
    });
  });

  it("does not call a lower final fare a cap", () => {
    const ticket = towTicket({
      towFare: {
        final: 341000,
        waitingFee: 0,
        baseFee: 500000,
        perKmFee: 25000,
        includedKm: 10,
        billableKm: 0,
        ceiling: 550000,
        night: false,
      },
    });
    const {breakdown} = breakdownFor(ticket, 341000);
    expect(breakdown).toContainEqual({
      code: "ADJUSTMENT",
      label: "Fare adjustment",
      amount: -159000,
      detail: "final fare 341000",
    });
    expect(breakdown.some((row) => row.code === "CEILING")).toBe(false);
  });
});

describe("billableAmountFor", () => {
  it("treats warranty rework as non-billable", () => {
    expect(billableAmountFor(walkTicket({
      warrantyOfTicketId: "orig1",
      shopQuotedAmount: 150000,
    }) as never)).toBeNull();
    expect(billableAmountFor(walkTicket({
      warrantyClaimId: "wc1",
      invoiceAmount: 150000,
      invoiceApproval: "APPROVED",
    }) as never)).toBeNull();
  });

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

  it("bills an SOS fix while the shop is working", () => {
    expect(
      billableAmountFor(ticket("sos6", {
        ticketType: "SOS",
        status: STATUS_DISPATCH.IN_PROGRESS,
        assignedShopId: "mobile1",
        mobileCallOutFee: 50000,
        finalAmount: 23000,
      }) as never),
    ).toEqual({amount: 73000, waitingFee: 0});
  });

  it("bills prior tower travel after a tower cancels the tow", () => {
    expect(billableAmountFor(towTicket({
      status: STATUS_DISPATCH.CANCELLED,
      cancelledBy: "towerop1",
      towFare: {final: null, estimate: 200000, waitingFee: 0},
      towFeeHistory: [{shopId: "old", amount: 50000, deadheadKm: 2, loadedKm: 3}],
    }) as never)).toEqual({amount: 50000, waitingFee: 0});
  });

  it("does not bill a tower cancel without prior travel", () => {
    expect(billableAmountFor(towTicket({
      status: STATUS_DISPATCH.CANCELLED,
      cancelledBy: "towerop1",
      towFare: {final: null, estimate: 200000, waitingFee: 0},
    }) as never)).toBeNull();
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
  it("builds a bill for one ticket", async () => {
    routeTickets(towTicket(), walkTicket());
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {id: "shop1", name: "Fix Shop", operatorUid: "shopop1"},
    );
    const tow = await getBill({userId: "rider1", ticketId: "tow1"});
    expect(tow).toMatchObject({
      billId: "tow1",
      ticketId: "tow1",
      viewer: "RIDER",
      canPay: true,
      total: 220000,
      due: 220000,
    });
    expect(tow.items).toHaveLength(1);
    expect(tow.items[0]).toMatchObject({
      kind: "TOW_FARE",
      ticketId: "tow1",
      amount: 220000,
      waitingFee: 20000,
      status: "UNPAID",
      payeeName: "Tow Co",
    });
    const repair = await getBill({userId: "rider1", ticketId: "walk1"});
    expect(repair.billId).toBe("walk1");
    expect(repair.items).toHaveLength(1);
    expect(repair.items[0]).toMatchObject({
      kind: "REPAIR",
      ticketId: "walk1",
      amount: 150000,
      payeeName: "Fix Shop",
    });
  });

  it("keeps the SOS bill available while work is in progress", async () => {
    const sos = ticket("sos6", {
      ticketType: "SOS",
      status: STATUS_DISPATCH.IN_PROGRESS,
      assignedShopId: "mobile1",
      mobileCallOutFee: 50000,
      finalAmount: 23000,
    });
    routeTickets(sos);
    routeProviders({id: "mobile1", name: "Mobile Shop", operatorUid: "mop"});
    const bill = await getBill({userId: "rider1", ticketId: "sos6"});
    expect(bill.items).toHaveLength(1);
    expect(bill).toMatchObject({
      ticketType: "SOS",
      total: 73000,
      due: 73000,
    });
    expect(bill.items[0]).toMatchObject({
      kind: "REPAIR",
      ticketId: "sos6",
      amount: 73000,
    });
  });

  it("shows the prior tower distance on a cancelled tow", async () => {
    const tow = towTicket({
      status: STATUS_DISPATCH.CANCELLED,
      cancelledBy: "towerop1",
      towFare: {final: null, estimate: 200000, waitingFee: 0},
      towFeeHistory: [
        {
          shopId: "old1",
          shopName: "Old Tow",
          amount: 50000,
          deadheadKm: 2.5,
          loadedKm: 5,
          at: "2026-10-01T00:00:00.000Z",
          reasonCode: "TOWER_CANCEL_BREAKDOWN",
        },
        {
          shopId: "old2",
          shopName: "Older Tow",
          amount: 30000,
          deadheadKm: 1.2,
          loadedKm: 0,
          at: "2026-10-01T00:10:00.000Z",
          reasonCode: "TOWER_CANCEL_BREAKDOWN",
        },
      ],
    });
    routeTickets(tow);
    routeProviders({id: "tower1", name: "Tow Co", operatorUid: "towerop1"});
    const bill = await getBill({userId: "rider1", ticketId: "tow1"});
    expect(bill.items).toHaveLength(1);
    expect(bill.items[0]).toMatchObject({amount: 80000, status: "UNPAID"});
    expect(bill.items[0].breakdown.filter((row) =>
      row.code === "PRIOR_TOW")).toEqual([
      {
        code: "PRIOR_TOW",
        label: "Prior tower travel",
        amount: 50000,
        detail: "7.50 km · Old Tow",
      },
      {
        code: "PRIOR_TOW",
        label: "Prior tower travel",
        amount: 30000,
        detail: "1.20 km · Older Tow",
      },
    ]);
    expect(bill.total).toBe(80000);
  });

  it("exposes the TOW formula, pickup and drop-off", async () => {
    const detailed = towTicket({
      towFare: {
        final: 525000,
        estimate: 525000,
        ceiling: 578000,
        baseFee: 500000,
        perKmFee: 25000,
        includedKm: 10,
        billableKm: 1.01,
        night: false,
        nightMultiplier: 1.5,
        waitingFee: 0,
        loadedKm: 11.011,
        deadheadKm: 9.92,
        vehicleClass: "CAR",
      },
      towActual: {quotedKm: 11.02, actualKm: 11.01, cappedKm: 12.66},
      destinationSnapshot: {
        id: "shop1",
        name: "103",
        lat: 10.75,
        lng: 106.7,
        kind: "SHOP",
      },
    });
    routeTickets(detailed);
    routeProviders(
      {id: "tower1", name: "Tow Co", operatorUid: "towerop1"},
      {
        id: "shop1",
        name: "Fix Shop",
        label: "12 Nguyen Trai",
        operatorUid: "shopop1",
      },
    );
    const bill = await getBill({userId: "rider1", ticketId: "tow1"});
    const item = bill.items[0];
    expect(item).toMatchObject({
      baseFee: 500000,
      perKmFee: 25000,
      includedKm: 10,
      billableKm: 1.01,
      ceiling: 578000,
      nightMultiplier: 1.5,
      vehicleClass: "CAR",
      totalDistanceKm: 20.94,
      deadheadKm: 9.92,
      loadedQuotedKm: 11.02,
      pickup: {lat: 10.7, lng: 106.6},
      destination: {
        shopId: "shop1",
        name: "Fix Shop",
        label: "12 Nguyen Trai",
        lat: 10.75,
        lng: 106.7,
      },
    });
    expect(item.breakdown).toEqual([
      {code: "BASE", label: "Base fare", amount: 500000,
        detail: "includes first 10 km"},
      {code: "DISTANCE", label: "Distance", amount: 25000,
        detail: "1.01 km × 25.000 ₫/km · loaded 11.01 km · " +
          "first 10 km included"},
    ]);
    expect(item.breakdown.reduce((sum, row) => sum + row.amount, 0))
      .toBe(item.amount);
  });

  it("infers included km for legacy TOW quotes", async () => {
    const legacy = towTicket({
      vehicleClass: "CAR",
      towFare: {
        final: 525000,
        estimate: 525000,
        ceiling: 578000,
        baseFee: 500000,
        perKmFee: 25000,
        night: false,
        waitingFee: 0,
        loadedKm: 11.011,
        vehicleClass: "CAR",
      },
      towActual: {actualKm: 11.01, cappedKm: 12.66},
    });
    routeTickets(legacy);
    routeProviders({id: "tower1", name: "Tow Co", operatorUid: "towerop1"});
    const bill = await getBill({userId: "rider1", ticketId: "tow1"});
    const item = bill.items[0];
    expect(item).toMatchObject({
      includedKm: 10,
      billableKm: 1.01,
      nightMultiplier: null,
    });
    expect(item.breakdown).toEqual([
      {code: "BASE", label: "Base fare", amount: 500000,
        detail: "includes first 10 km"},
      {code: "DISTANCE", label: "Distance", amount: 25000,
        detail: "1.01 km × 25.000 ₫/km · loaded 11.01 km · " +
          "first 10 km included"},
    ]);
  });

  it("shows the night multiplier as its own fare line", async () => {
    const nightTow = towTicket({
      towFare: {
        final: 825000,
        estimate: 825000,
        ceiling: 908000,
        baseFee: 500000,
        perKmFee: 25000,
        includedKm: 10,
        billableKm: 2,
        night: true,
        nightMultiplier: 1.5,
        waitingFee: 0,
        loadedKm: 12,
        vehicleClass: "CAR",
      },
      towActual: {actualKm: 12, cappedKm: 12},
    });
    routeTickets(nightTow);
    routeProviders({id: "tower1", name: "Tow Co", operatorUid: "towerop1"});
    const bill = await getBill({userId: "rider1", ticketId: "tow1"});
    const item = bill.items[0];
    expect(item.breakdown).toEqual([
      {code: "BASE", label: "Base fare", amount: 500000,
        detail: "includes first 10 km"},
      {code: "DISTANCE", label: "Distance", amount: 50000,
        detail: "2.00 km × 25.000 ₫/km · loaded 12.00 km · " +
          "first 10 km included"},
      {code: "NIGHT", label: "Night surcharge", amount: 275000,
        detail: "x1.5 on base + distance"},
    ]);
    expect(item.breakdown.reduce((sum, row) => sum + row.amount, 0))
      .toBe(item.amount);
  });

  it("keeps prior tower travel additive in the breakdown", async () => {
    const partial = towTicket({
      towFare: {
        final: 300000,
        estimate: 300000,
        ceiling: 500000,
        baseFee: 150000,
        perKmFee: 10000,
        includedKm: 3,
        billableKm: 2,
        night: false,
        nightMultiplier: 1.5,
        waitingFee: 0,
        loadedKm: 5,
        vehicleClass: "SOLO_BIKE",
      },
      towActual: {actualKm: 5, cappedKm: 5},
      towFeeHistory: [{
        amount: 50000,
        shopId: "old",
        reasonCode: "TOWER_CANCEL_BREAKDOWN",
      }],
    });
    routeTickets(partial);
    routeProviders({id: "tower1", name: "Tow Co", operatorUid: "towerop1"});
    const bill = await getBill({userId: "rider1", ticketId: "tow1"});
    const item = bill.items[0];
    expect(item.breakdown.map((row) => row.code)).toEqual([
      "BASE",
      "DISTANCE",
      "PRIOR_TOW",
      "ADJUSTMENT",
    ]);
    expect(item.breakdown.reduce((sum, row) => sum + row.amount, 0))
      .toBe(item.amount);
  });

  it("returns an empty bill for warranty rework", async () => {
    routeTickets(walkTicket({
      status: STATUS_DISPATCH.RESOLVED,
      warrantyOfTicketId: "orig1",
      shopQuotedAmount: 150000,
    }));
    routeProviders({id: "shop1", name: "Fix Shop", operatorUid: "shopop1"});
    const bill = await getBill({userId: "rider1", ticketId: "walk1"});
    expect(bill.items).toHaveLength(0);
    expect(bill.total).toBe(0);
    expect(bill.status).toBe("VOID");
  });

  it("reports a paid ticket", async () => {
    routeTickets(towTicket());
    jest
      .mocked(paymentRepository.findByTicketId)
      .mockResolvedValue([payment() as never]);
    const bill = await getBill({userId: "rider1", billId: "tow1"});
    expect(bill.items[0].status).toBe("PAID");
    expect(bill.items[0].payment).toMatchObject({
      method: "CASH",
      status: "CONFIRMED",
      commissionAmount: 22000,
      payoutAmount: 198000,
      payoutStatus: "PENDING",
      canConfirmCash: false,
      createdAt: "2026-10-01T00:30:00.000Z",
      confirmedAt: "2026-10-01T01:00:00.000Z",
    });
    expect(bill.paid).toBe(220000);
    expect(bill.due).toBe(0);
    expect(bill.status).toBe("PAID");
  });

  it("voids an unfixable walk-in", async () => {
    routeTickets(walkTicket({status: STATUS_DISPATCH.UNFIXABLE}));
    const bill = await getBill({userId: "rider1", ticketId: "walk1"});
    expect(bill.items[0].status).toBe("VOID");
    expect(bill.status).toBe("VOID");
  });

  it("scopes a payee to their own ticket", async () => {
    routeTickets(towTicket(), walkTicket());
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
    expect(bill.billId).toBe("walk1");
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
    await expect(requestForbidden("shopop1", "tow1"))
      .rejects.toThrow("Not allowed to view this bill");
  });

  it("refuses a rider from using the payee scope", async () => {
    routeTickets(towTicket());
    await expect(
      getBill({userId: "rider1", ticketId: "tow1", scope: "payee"}),
    ).rejects.toThrow("Only the payee views a payee bill");
  });

  it("refuses a user who is not part of the ticket", async () => {
    routeTickets(towTicket());
    jest
      .mocked(userRepository.findById)
      .mockResolvedValue({id: "other", role: "2"} as never);
    await expect(
      getBill({userId: "other", ticketId: "tow1"}),
    ).rejects.toThrow("Not allowed to view this bill");
  });

  it("lets an admin read any bill", async () => {
    routeTickets(towTicket());
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

const requestForbidden = (
  userId: string,
  ticketId: string,
): Promise<unknown> => getBill({userId, ticketId});

describe("billService.listBills", () => {
  it("lists one bill per ticket", async () => {
    const tow = towTicket({createdAt: "2026-10-03T00:00:00.000Z"});
    const spawned = walkTicket({
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
      assignedShopId: "mobile1",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    routeTickets(tow, spawned, standalone, sos);
    routeProviders({id: "mobile1", name: "Mobile", operatorUid: "mop"});
    jest
      .mocked(dispatchRepository.findByUserId)
      .mockResolvedValue([spawned, standalone, sos, tow]);
    const bills = await listBills({userId: "rider1"});
    expect(bills.map((b) => b.billId)).toEqual([
      "walk1",
      "tow1",
      "walk2",
    ]);
    for (const bill of bills) expect(bill.items).toHaveLength(1);
  });

  it("lists an unfixable SOS call-out bill", async () => {
    const sos = ticket("sos1", {
      ticketType: "SOS",
      status: STATUS_DISPATCH.UNFIXABLE,
      assignedShopId: "mobile1",
      mobileCallOutFee: 50000,
      mobileTravelFee: 41000,
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
    expect(bills[0]?.items[0]?.breakdown).toEqual([
      {code: "CALLOUT", label: "Call-out", amount: 50000, detail: null},
    ]);
  });

  it("lists an SOS fix while the shop is working", async () => {
    const sos = ticket("sos6", {
      ticketType: "SOS",
      status: STATUS_DISPATCH.IN_PROGRESS,
      assignedShopId: "mobile1",
      mobileCallOutFee: 0,
      finalAmount: 70000,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    routeTickets(sos);
    routeProviders({id: "mobile1", name: "Mobile Shop", operatorUid: "op1"});
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([sos]);
    const bills = await listBills({userId: "rider1"});
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      billId: "sos6",
      ticketType: "SOS",
      total: 70000,
    });
  });

  it("lists a cancelled tow with prior tower travel", async () => {
    const tow = towTicket({
      status: STATUS_DISPATCH.CANCELLED,
      cancelledBy: "towerop1",
      towFare: {final: null, estimate: 200000, waitingFee: 0},
      towFeeHistory: [{shopId: "old", amount: 50000, deadheadKm: 2, loadedKm: 3}],
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    routeTickets(tow);
    routeProviders({id: "tower1", name: "Tow Co", operatorUid: "towerop1"});
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([tow]);
    const bills = await listBills({userId: "rider1"});
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      billId: "tow1",
      ticketType: "TOW",
      total: 50000,
    });
  });

  it("shows fixed SOS travel as kilometers and rate", async () => {
    const sos = ticket("sos2", {
      ticketType: "SOS",
      status: STATUS_DISPATCH.RESOLVED,
      assignedShopId: "mobile1",
      mobileCallOutFee: 50000,
      mobileTravelFee: 41000,
      mobileTravelKm: 4.1,
      mobileTravelRate: 10000,
      finalAmount: 0,
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    routeTickets(sos);
    routeProviders({id: "mobile1", name: "Mobile Shop", operatorUid: "op1"});
    jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([sos]);
    const bills = await listBills({userId: "rider1"});
    expect(bills).toHaveLength(1);
    expect(bills[0]?.items[0]?.breakdown).toContainEqual({
      code: "TRAVEL",
      label: "Travel",
      amount: 41000,
      detail: "4.10 km × 10.000 ₫/km",
    });
  });

  it("skips a ticket with nothing payable yet", async () => {
    const pendingTow = towTicket({towFare: null});
    routeTickets(pendingTow);
    jest
      .mocked(dispatchRepository.findByUserId)
      .mockResolvedValue([pendingTow]);
    await expect(listBills({userId: "rider1"})).resolves.toEqual([]);
  });

  it("caps the list", async () => {
    const first = towTicket();
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
  it("keeps only the shop's own ticket", async () => {
    const tow = towTicket();
    const spawned = walkTicket();
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
      billId: "walk1",
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

  it("keeps a tow payee to the tow ticket", async () => {
    const tow = towTicket();
    const spawned = walkTicket();
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
    expect(bills[0].billId).toBe("tow1");
    expect(bills[0].total).toBe(220000);
    expect(bills[0].items).toHaveLength(1);
    expect(bills[0].items[0]).toMatchObject({
      ticketId: "tow1",
      amount: 220000,
      payeeName: "Tow Co",
    });
  });
});
