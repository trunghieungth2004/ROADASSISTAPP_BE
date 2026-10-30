import * as dispatchRepository from "../../../../repository/dispatchRepository";
import * as userRepository from "../../../../repository/userRepository";
import * as providerRepository from "../../../../repository/providerRepository";
import * as vehicleProfileRepository from
  "../../../../repository/vehicleProfileRepository";


import * as paymentRepository from "../../../../repository/paymentRepository";

import {
  createDispatch,
  updateDispatchStatus,
  acceptDispatch,
  declineDispatch,
  sendQuote,
  markUnfixable,
  approveQuote,
  updateWorkOrder,
} from "../../../../service/dispatchService";
import {enqueueDispatchPush} from "../../../../service/taskQueueService";

jest.mock("../../../../repository/dispatchRepository");
jest.mock("../../../../repository/userRepository");
jest.mock("../../../../repository/providerRepository");
jest.mock("../../../../repository/vehicleProfileRepository");
jest.mock("../../../../repository/providerLocationRepository", () => ({
  findByIds: jest.fn(async () => new Map()),
  findByGeohashPrefixes: jest.fn(async () => []),
}));
jest.mock("../../../../repository/fcmTokenRepository");
jest.mock("../../../../repository/paymentRepository");
jest.mock("../../../../utils/valhalla", () => ({
  ...jest.requireActual("../../../../utils/valhalla"),
  postRoute: jest.fn(),
}));
jest.mock("../../../../service/taskQueueService");

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(vehicleProfileRepository.findById).mockResolvedValue({
    id: "v1",
  } as never);
  delete process.env.FCM_ENABLED;
  jest.mocked(dispatchRepository.findByUserId).mockResolvedValue([]);
});


describe("dispatchService walk-in tickets", () => {
  const shop = (extra?: Record<string, unknown>) => ({
    id: "shop9",
    name: "Fix",
    lat: 10.7,
    lng: 106.6,
    kind: "SHOP",
    status: "ACTIVE",
    operatorUid: "op1",
    ...(extra ?? {}),
  });
  const walkIn = (extra?: Record<string, unknown>) => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(dispatchRepository.create).mockResolvedValue({
      id: "t1",
      status: "1",
    } as never);
    return createDispatch({
      userId: "u1",
      ticketType: "WALK_IN",
      lat: 10.7,
      lng: 106.6,
      providerId: "shop9",
      vehicleType: "SCOOTER",
      ...(extra ?? {}),
    });
  };
  it("rejects walk-ins to shops that switched off", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop({accepting: false}) as never,
    );
    await expect(walkIn()).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("creates a walk-in with a shop snapshot", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop() as never,
    );
    await expect(walkIn()).resolves.toMatchObject({id: "t1"});
    expect(dispatchRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketType: "WALK_IN",
        providerId: "shop9",
        vehicleClass: "SOLO_BIKE",
      }),
    );
  });
  it("requires a shop for walk-in tickets", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    await expect(
      createDispatch({
        userId: "u1",
        ticketType: "WALK_IN",
        lat: 10.7,
        lng: 106.6,
      }),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects walk-in for cars", async () => {
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "u1",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop() as never,
    );
    await expect(
      walkIn({vehicleType: "CAR"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects a car-only shop for a bike walk-in", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue(
      shop({vehicleClasses: ["CAR"]}) as never,
    );
    await expect(walkIn()).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects a non-shop provider for walk-in", async () => {
    jest.mocked(providerRepository.findById).mockResolvedValue({
      ...shop(),
      kind: "TOW",
    } as never);
    await expect(walkIn()).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.create).not.toHaveBeenCalled();
  });
  it("rejects accepts for another provider's walk-in", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "other",
      kind: "SHOP",
      status: "ACTIVE",
      accepting: true,
      operatorUid: "op2",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op2",
      role: "2",
    } as never);
    await expect(
      acceptDispatch({userId: "op2", ticketId: "t1", shopId: "other"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
});


describe("dispatchService declineDispatch", () => {
  it("declines a pending walk-in for its operator", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(dispatchRepository.claimForAssignment).mockResolvedValue(
      true,
    );
    await expect(
      declineDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
      }),
    ).resolves.toEqual({declined: true});
    expect(dispatchRepository.claimForAssignment).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        assignedShopId: "shop9",
        assignedKind: "SHOP",
        status: "8",
        declineReason: "FULL",
      }),
      "op1",
    );
  });
  it("rejects decline of non-walk-in tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "SOS",
    } as never);
    await expect(
      declineDispatch({
        userId: "op1",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("rejects decline from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    await expect(
      declineDispatch({
        userId: "stranger",
        ticketId: "t1",
        shopId: "shop9",
        reason: "FULL",
      }),
    ).rejects.toMatchObject({statusCode: 403});
  });
});


describe("dispatchService updateWorkOrder", () => {
  it("lets the operator record work details on a matched ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({
        userId: "op1",
        ticketId: "t1",
        workType: "Tire change",
        invoiceRef: "INV-1",
      }),
    ).resolves.toEqual({updated: 1});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      {workType: "Tire change", invoiceRef: "INV-1"},
    );
  });
  it("rejects price edits on work orders", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({
        userId: "op1",
        ticketId: "t1",
        quotedAmount: 400000,
      }),
    ).rejects.toMatchObject({statusCode: 400});
  });
  it("rejects work orders from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "stranger",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("rejects work orders from tower operators", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "op1", ticketId: "t1", workType: "Tow"}),
    ).rejects.toMatchObject({statusCode: 403});
  });
  it("rejects work orders on resolved tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      status: "4",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateWorkOrder({userId: "op1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });
});


describe("dispatchService markUnfixable", () => {
  it("refuses SOS unfixable before arrival", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "SOS",
      assignedShopId: "mobile1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      kind: "MOBILE_SHOP",
      operatorUid: "op1",
    } as never);
    await expect(markUnfixable({
      userId: "op1",
      ticketId: "t1",
      reason: "Frame bent",
      photoUrls: ["dispatch/t1/frame.jpg"],
    })).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("allows SOS unfixable after arrival", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "3",
      ticketType: "SOS",
      assignedShopId: "mobile1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "mobile1",
      kind: "MOBILE_SHOP",
      operatorUid: "op1",
    } as never);
    jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
    await expect(markUnfixable({
      userId: "op1",
      ticketId: "t1",
      reason: "Frame bent",
      photoUrls: ["dispatch/t1/frame.jpg"],
    })).resolves.toEqual({unfixable: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "15",
      "op1",
    );
  });

  it("voids pending payments on an in-progress ticket", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "6",
      ticketType: "WALK_IN",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    const payment = {
      id: "p1",
      ticketId: "t1",
      method: "SEPAY",
      status: "PENDING",
      amount: 100000,
    };
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      payment,
    ] as never);
    jest.mocked(paymentRepository.updateStatus).mockResolvedValue({
      ...payment,
      status: "CANCELLED",
    } as never);
    await expect(markUnfixable({
      userId: "op1",
      ticketId: "t1",
      reason: "Frame bent",
      photoUrls: ["dispatch/t1/frame.jpg"],
    })).resolves.toEqual({unfixable: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "15",
      "op1",
    );
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      "p1",
      "CANCELLED",
    );
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({checkoutUrl: null}),
    );
  });
});


describe("dispatchService quote approval", () => {
  it("sends a quote and flips the ticket to quoted", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      providerId: "shop9",
      assignedShopId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).resolves.toEqual({quoted: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({shopQuotedAmount: 150000}),
    );
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "9",
      "op1",
    );
  });

  it("rejects quotes from tower operators", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "TOW",
      assignedShopId: "tow1",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "tow1",
      kind: "TOW",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects quotes off active tickets", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "1",
      ticketType: "WALK_IN",
      providerId: "shop9",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 150000}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("approves a pending quote into in-progress", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      {id: "p1", method: "CASH", status: "PENDING"},
    ] as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "6",
      "rider1",
    );
    expect(enqueueDispatchPush).toHaveBeenCalledWith(
      "t1",
      expect.stringContaining("operator"),
      expect.objectContaining({audience: "operator"}),
    );
  });

  it("refuses approval without a pending quote", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
    } as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });

  it("refuses approval without a qualifying payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([]);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("approves a final quote on a held sepay payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "11",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
      finalAmount: 140000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      {id: "p1", method: "SEPAY", status: "HELD"},
    ] as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
    expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
      "t1",
      "6",
      "rider1",
    );
  });

  it("approves on a confirmed cash payment", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      providerId: "shop9",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(paymentRepository.findByTicket).mockResolvedValue([
      {id: "p1", method: "CASH", status: "CONFIRMED"},
    ] as never);
    await expect(
      approveQuote({userId: "rider1", ticketId: "t1"}),
    ).resolves.toEqual({approved: true});
  });

  it("refuses approval from strangers", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "9",
      ticketType: "WALK_IN",
      shopQuotedAmount: 150000,
    } as never);
    await expect(
      approveQuote({userId: "stranger", ticketId: "t1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("blocks quoted tickets from starting directly", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
      shopQuotedAmount: 150000,
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "op1",
      role: "2",
    } as never);
    jest.mocked(providerRepository.findById).mockResolvedValue({
      id: "shop9",
      kind: "SHOP",
      operatorUid: "op1",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "6", userId: "op1"}),
    ).rejects.toMatchObject({statusCode: 403});
  });

  it("rejects raw status writes of quoted", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "t1",
      userId: "rider1",
      status: "2",
      ticketType: "WALK_IN",
    } as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "rider1",
      role: "2",
    } as never);
    await expect(
      updateDispatchStatus({id: "t1", status: "9", userId: "rider1"}),
    ).rejects.toMatchObject({statusCode: 400});
  });
});

it("refuses work states to non-operators", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "3",
    ticketType: "SOS",
    assignedUid: "vol1",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "vol1",
    role: "2",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "6", userId: "vol1"}),
  ).rejects.toMatchObject({statusCode: 403});
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "6",
    ticketType: "SOS",
    assignedUid: "vol1",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "7", userId: "vol1"}),
  ).rejects.toMatchObject({statusCode: 403});
});

it("blocks status changes while a dispute hold is active", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "7",
    ticketType: "SOS",
    assignedShopId: "mobile1",
    finalAmount: 120000,
    disputeHold: true,
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "rider1",
    role: "2",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
  ).rejects.toMatchObject({statusCode: 403});
});

it("lets the assigned mobile shop mark an SOS fix complete", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "3",
    ticketType: "SOS",
    assignedShopId: "mobile1",
    finalAmount: 120000,
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "mobile1",
    kind: "MOBILE_SHOP",
    operatorUid: "op1",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "7", userId: "op1"}),
  ).resolves.toBeDefined();
  expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
    "t1",
    "7",
    "op1",
  );
});

it("requires the fix fee before an SOS fix is complete", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "3",
    ticketType: "SOS",
    assignedShopId: "mobile1",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "mobile1",
    kind: "MOBILE_SHOP",
    operatorUid: "op1",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "7", userId: "op1"}),
  ).rejects.toMatchObject({statusCode: 400});
});

it("blocks the rider from cancelling an SOS after fix complete", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "7",
    ticketType: "SOS",
    assignedShopId: "mobile1",
    finalAmount: 120000,
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "rider1",
    role: "2",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "5", userId: "rider1"}),
  ).rejects.toMatchObject({statusCode: 403});
});

it("lets the rider resolve an SOS after fix complete", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "7",
    ticketType: "SOS",
    assignedShopId: "mobile1",
    finalAmount: 120000,
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "rider1",
    role: "2",
  } as never);
  await expect(
    updateDispatchStatus({id: "t1", status: "4", userId: "rider1"}),
  ).resolves.toBeDefined();
  expect(dispatchRepository.updateStatus).toHaveBeenCalledWith(
    "t1",
    "4",
    "rider1",
  );
});

it("refuses quotes on shopless tickets", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    userId: "rider1",
    status: "2",
    ticketType: "SOS",
    assignedUid: "vol1",
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "vol1",
    role: "2",
  } as never);
  await expect(
    sendQuote({userId: "vol1", ticketId: "t1", quotedAmount: 50000}),
  ).rejects.toMatchObject({statusCode: 400});
  await expect(
    approveQuote({userId: "rider1", ticketId: "t1"}),
  ).rejects.toMatchObject({statusCode: 400});
});

it("refuses to re-quote or re-finalize", async () => {
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    status: "2",
    ticketType: "WALK_IN",
    providerId: "shop9",
    assignedShopId: "shop9",
    shopQuotedAmount: 150000,
  } as never);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockResolvedValue({
    id: "shop9",
    kind: "SHOP",
    operatorUid: "op1",
  } as never);
  await expect(
    updateWorkOrder({userId: "op1", ticketId: "t1", quotedAmount: 160000}),
  ).rejects.toMatchObject({statusCode: 400});
  await expect(
    sendQuote({userId: "op1", ticketId: "t1", quotedAmount: 160000}),
  ).rejects.toMatchObject({statusCode: 400});
  jest.mocked(dispatchRepository.findById).mockResolvedValue({
    id: "t1",
    status: "6",
    ticketType: "WALK_IN",
    assignedShopId: "shop9",
    finalAmount: 140000,
  } as never);
  await expect(
    updateWorkOrder({userId: "op1", ticketId: "t1", finalAmount: 130000}),
  ).rejects.toMatchObject({statusCode: 400});
});
