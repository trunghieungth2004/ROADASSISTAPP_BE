import {beforeEach, describe, expect, jest, test} from "@jest/globals";
import * as dispatchRepository from "../../../repository/dispatchRepository";
import * as providerRepository from "../../../repository/providerRepository";
import * as userRepository from "../../../repository/userRepository";
import {
  offerMobileShopTow,
  respondMobileShopTow,
} from "../../../service/dispatch/shop";
import {createDispatch} from "../../../service/dispatch/tickets";
import {acceptDispatch} from "../../../service/dispatch/accept";
import {continueSos} from "../../../service/dispatch/sos";

jest.mock("../../../repository/dispatchRepository");
jest.mock("../../../repository/providerRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../repository/paymentRepository");
jest.mock("../../../service/dispatch/tickets", () => ({
  createDispatch: jest.fn(),
}));
jest.mock("../../../service/dispatch/accept", () => ({
  acceptDispatch: jest.fn(),
}));
jest.mock("../../../service/dispatch/sos", () => ({
  continueSos: jest.fn(),
}));
jest.mock("../../../service/dispatch/candidates", () => ({
  findTowOperators: jest.fn(async () => ["op2"]),
}));
jest.mock("../../../service/chatService", () => ({
  chatService: {addSystemEvent: jest.fn(async () => undefined)},
}));
jest.mock("../../../service/taskQueueService", () => ({
  enqueueDispatchPush: jest.fn(async () => ({enqueued: true})),
}));

const mobileShop = {
  id: "mobile1",
  kind: "MOBILE_SHOP",
  operatorUid: "op1",
  status: "ACTIVE",
  accepting: true,
  vehicleType: "CAR",
  vehicleProfileId: "profile1",
};

const sameTow = {
  id: "tow1",
  kind: "TOW",
  operatorUid: "op1",
  status: "ACTIVE",
  accepting: true,
  plate: "51A-12345",
  vehicleProfileId: "profile1",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchRepository.findActiveForShop).mockResolvedValue([]);
  jest.mocked(dispatchRepository.update).mockResolvedValue(undefined);
  jest.mocked(dispatchRepository.updateStatus).mockResolvedValue(undefined);
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "op1",
    role: "2",
  } as never);
  jest.mocked(providerRepository.findById).mockImplementation(async (id) => {
    if (id === "mobile1") return mobileShop as never;
    if (id === "tow1") return sameTow as never;
    if (id === "shop1") {
      return {
        id: "shop1",
        kind: "SHOP",
        operatorUid: "op1",
        status: "ACTIVE",
      } as never;
    }
    return null;
  });
  jest.mocked(providerRepository.findByOperator).mockResolvedValue([
    mobileShop,
    sameTow,
  ] as never);
});

describe("offerMobileShopTow", () => {
  test("requires a same-vehicle TOW and offers DIRECT only", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "sos1",
      userId: "rider1",
      ticketType: "SOS",
      status: "15",
      assignedShopId: "mobile1",
      lat: 10.7,
      lng: 106.6,
    } as never);

    await expect(offerMobileShopTow({
      userId: "op1",
      ticketId: "sos1",
      destinationShopId: "shop1",
    })).resolves.toMatchObject({offered: true});

    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        mobileTowOffer: expect.objectContaining({
          mode: "DIRECT",
          towProviderId: "tow1",
          destinationShopId: "shop1",
        }),
      }),
    );
  });

  test("offers without a destination so the rider can choose", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "sos1",
      userId: "rider1",
      ticketType: "SOS",
      status: "15",
      assignedShopId: "mobile1",
      lat: 10.7,
      lng: 106.6,
    } as never);

    await expect(offerMobileShopTow({
      userId: "op1",
      ticketId: "sos1",
    })).resolves.toMatchObject({offered: true});
    expect(dispatchRepository.update).toHaveBeenCalledWith(
      "sos1",
      expect.objectContaining({
        mobileTowOffer: expect.objectContaining({
          destinationShopId: null,
        }),
      }),
    );
  });

  test("refuses an off-duty destination shop", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "sos1",
      userId: "rider1",
      ticketType: "SOS",
      status: "15",
      assignedShopId: "mobile1",
      lat: 10.7,
      lng: 106.6,
    } as never);
    jest.mocked(providerRepository.findById).mockImplementation(async (id) => {
      if (id === "mobile1") return mobileShop as never;
      if (id === "tow1") return sameTow as never;
      if (id === "shop1") {
        return {
          id: "shop1",
          kind: "SHOP",
          operatorUid: "op1",
          status: "ACTIVE",
          accepting: false,
        } as never;
      }
      return null;
    });

    await expect(offerMobileShopTow({
      userId: "op1",
      ticketId: "sos1",
      destinationShopId: "shop1",
    })).rejects.toMatchObject({statusCode: 400});
    expect(dispatchRepository.update).not.toHaveBeenCalled();
  });

  test("offers a network tow when the operator has no same-vehicle TOW",
    async () => {
      jest.mocked(dispatchRepository.findById).mockResolvedValue({
        id: "sos1",
        userId: "rider1",
        ticketType: "SOS",
        status: "15",
        assignedShopId: "mobile1",
        lat: 10.7,
        lng: 106.6,
      } as never);
      jest.mocked(providerRepository.findByOperator).mockResolvedValue([
        mobileShop,
      ] as never);

      await expect(offerMobileShopTow({
        userId: "op1",
        ticketId: "sos1",
      })).resolves.toMatchObject({offered: true, mode: "NETWORK"});
      expect(dispatchRepository.update).toHaveBeenCalledWith(
        "sos1",
        expect.objectContaining({
          mobileTowOffer: expect.objectContaining({
            mode: "NETWORK",
            towProviderId: null,
          }),
        }),
      );
    });

  test("offers a network tow when the linked TOW is off duty", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      id: "sos1",
      userId: "rider1",
      ticketType: "SOS",
      status: "15",
      assignedShopId: "mobile1",
      lat: 10.7,
      lng: 106.6,
    } as never);
    jest.mocked(providerRepository.findByOperator).mockResolvedValue([
      mobileShop,
      {...sameTow, accepting: false},
    ] as never);

    await expect(offerMobileShopTow({
      userId: "op1",
      ticketId: "sos1",
    })).resolves.toMatchObject({offered: true, mode: "NETWORK"});
  });
});

describe("respondMobileShopTow", () => {
  const pending = {
    id: "sos1",
    userId: "rider1",
    ticketType: "SOS",
    status: "15",
    assignedShopId: "mobile1",
    lat: 10.7,
    lng: 106.6,
    note: "Bike dead",
    description: "No spark",
    photoUrls: ["dispatch/sos1/a.jpg"],
    vehicleType: "BIKE",
    mobileTowOffer: {
      status: "PENDING",
      shopId: "mobile1",
      destinationShopId: "shop1",
      mode: "DIRECT",
      towProviderId: "tow1",
      by: "op1",
      at: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:15:00.000Z",
    },
  };

  test("creates a linked TOW with the rider data and accepts it directly",
    async () => {
      jest.mocked(dispatchRepository.findById)
        .mockResolvedValue(pending as never);
      jest.mocked(createDispatch).mockResolvedValue({id: "towNew"} as never);
      jest.mocked(acceptDispatch).mockResolvedValue({} as never);

      await expect(respondMobileShopTow({
        userId: "rider1",
        ticketId: "sos1",
        accept: true,
      })).resolves.toEqual({accepted: true, ticketId: "towNew"});

      expect(createDispatch).toHaveBeenCalledWith(expect.objectContaining({
        ticketType: "TOW",
        providerId: "tow1",
        sourceTicketId: "sos1",
        note: "Bike dead",
        description: "No spark",
        photoUrls: ["dispatch/sos1/a.jpg"],
        destinationShopId: "shop1",
      }));
      expect(acceptDispatch).toHaveBeenCalledWith({
        userId: "op1",
        ticketId: "towNew",
        shopId: "tow1",
      });
    });

  test("creates a pending broadcast TOW for a network offer", async () => {
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValue({
        ...pending,
        mobileTowOffer: {
          ...pending.mobileTowOffer,
          mode: "NETWORK",
          towProviderId: null,
        },
      } as never);
    jest.mocked(createDispatch).mockResolvedValue({id: "towNew"} as never);

    await expect(respondMobileShopTow({
      userId: "rider1",
      ticketId: "sos1",
      accept: true,
    })).resolves.toEqual({
      accepted: true,
      ticketId: "towNew",
      network: true,
    });

    expect(createDispatch).toHaveBeenCalledWith(expect.objectContaining({
      ticketType: "TOW",
      addressedTow: false,
      sourceTicketId: "sos1",
      destinationShopId: "shop1",
    }));
    expect(createDispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({providerId: expect.anything()}),
    );
    expect(acceptDispatch).not.toHaveBeenCalled();
  });

  test("refuses an off-duty destination shop", async () => {
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValue(pending as never);
    jest.mocked(providerRepository.findById).mockImplementation(async (id) => {
      if (id === "mobile1") return mobileShop as never;
      if (id === "tow1") return sameTow as never;
      if (id === "shop1") {
        return {
          id: "shop1",
          kind: "SHOP",
          operatorUid: "op1",
          status: "ACTIVE",
          accepting: false,
        } as never;
      }
      return null;
    });

    await expect(respondMobileShopTow({
      userId: "rider1",
      ticketId: "sos1",
      accept: true,
    })).rejects.toMatchObject({statusCode: 400});
    expect(createDispatch).not.toHaveBeenCalled();
  });

  test("declines and asks for continuation", async () => {
    jest.mocked(dispatchRepository.findById)
      .mockResolvedValue(pending as never);
    jest.mocked(continueSos).mockResolvedValue({
      ticketId: "sos2",
      attempt: 2,
      callOutTotal: 100000,
    } as never);

    await expect(respondMobileShopTow({
      userId: "rider1",
      ticketId: "sos1",
      accept: false,
    })).resolves.toMatchObject({accepted: false, ticketId: "sos2"});
    expect(continueSos).toHaveBeenCalledWith({
      userId: "rider1",
      ticketId: "sos1",
      auto: true,
    });
  });

  test("requires a destination when the offer has none", async () => {
    jest.mocked(dispatchRepository.findById).mockResolvedValue({
      ...pending,
      mobileTowOffer: {...pending.mobileTowOffer, destinationShopId: null},
    } as never);

    await expect(respondMobileShopTow({
      userId: "rider1",
      ticketId: "sos1",
      accept: true,
    })).rejects.toMatchObject({statusCode: 400});
  });
});
