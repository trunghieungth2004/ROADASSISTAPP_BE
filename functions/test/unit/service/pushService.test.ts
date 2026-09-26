import * as flagRepository from "../../../repository/flagRepository";
import * as activeRouteRepository from
  "../../../repository/activeRouteRepository";
import * as fcmTokenRepository from "../../../repository/fcmTokenRepository";
import {messaging} from "../../../config/firebase";
import {deliverHazardPush} from "../../../service/pushService";

jest.mock("../../../repository/flagRepository");
jest.mock("../../../repository/activeRouteRepository");
jest.mock("../../../repository/fcmTokenRepository");

const sendEach = jest.mocked(messaging.sendEach);

const crossing = {
  type: "LineString",
  coordinates: [
    [106.66, 10.76],
    [106.7, 10.78],
  ],
};
const far = {
  type: "LineString",
  coordinates: [
    [106.0, 10.0],
    [106.01, 10.01],
  ],
};
const flag = {
  id: "flood-1",
  type: "FLOOD",
  status: "2",
  lat: 10.77,
  lng: 106.68,
  radiusMeters: 200,
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FCM_ENABLED;
  sendEach.mockResolvedValue({
    successCount: 0,
    failureCount: 0,
    responses: [],
  });
});

describe("pushService.deliverHazardPush", () => {
  it("skips when FCM is disabled", async () => {
    await expect(deliverHazardPush({flagId: "flood-1"})).resolves.toEqual({
      delivered: 0,
      skipped: true,
    });
    expect(flagRepository.findById).not.toHaveBeenCalled();
  });

  it("skips unknown flags", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue(null);
    await expect(deliverHazardPush({flagId: "ghost"})).resolves.toEqual({
      delivered: 0,
      skipped: true,
    });
    expect(sendEach).not.toHaveBeenCalled();
  });

  it("skips non-blocking flags", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue({
      ...flag,
      status: "5",
    } as never);
    await expect(deliverHazardPush({flagId: "flood-1"})).resolves.toEqual({
      delivered: 0,
      skipped: true,
    });
    expect(sendEach).not.toHaveBeenCalled();
  });

  it("delivers suggested flags to crossing routes", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue({
      ...flag,
      status: "1",
    } as never);
    jest.mocked(activeRouteRepository.findNearFlag).mockResolvedValue([
      {userId: "u1", geometry: JSON.stringify(crossing)},
    ] as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "u1",
      tokens: ["u1-token"],
    } as never);
    sendEach.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{success: true} as never],
    });
    await expect(deliverHazardPush({flagId: "flood-1"})).resolves.toEqual({
      delivered: 1,
      skipped: false,
    });
    const messages = sendEach.mock.calls[0][0];
    expect(messages[0].notification?.body).toContain("reported");
  });

  it("excludes the reporter from targets", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue({
      ...flag,
      reporterUid: "u1",
    } as never);
    jest.mocked(activeRouteRepository.findNearFlag).mockResolvedValue([
      {userId: "u1", geometry: JSON.stringify(crossing)},
      {userId: "u2", geometry: JSON.stringify(crossing)},
    ] as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockImplementation(
      async (userId: string) =>
        ({userId, tokens: [`${userId}-token`]} as never),
    );
    sendEach.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{success: true} as never],
    });
    await expect(deliverHazardPush({flagId: "flood-1"})).resolves.toEqual({
      delivered: 1,
      skipped: false,
    });
    const messages = sendEach.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({token: "u2-token"});
  });

  it("notifies users whose active routes cross the flag", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue(flag as never);
    jest.mocked(activeRouteRepository.findNearFlag).mockResolvedValue([
      {userId: "u1", geometry: JSON.stringify(crossing)},
      {userId: "u2", geometry: JSON.stringify(far)},
    ] as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockImplementation(
      async (userId: string) =>
        ({userId, tokens: [`${userId}-token`]} as never),
    );
    sendEach.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{success: true} as never],
    });
    await expect(deliverHazardPush({flagId: "flood-1"})).resolves.toEqual({
      delivered: 1,
      skipped: false,
    });
    expect(sendEach).toHaveBeenCalledTimes(1);
    const messages = sendEach.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      token: "u1-token",
      data: {flagId: "flood-1", type: "FLOOD"},
    });
    expect(messages[0].notification).toBeDefined();
  });

  it("prunes dead tokens after sending", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue(flag as never);
    jest.mocked(activeRouteRepository.findNearFlag).mockResolvedValue([
      {userId: "u1", geometry: JSON.stringify(crossing)},
    ] as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "u1",
      tokens: ["good", "dead"],
    } as never);
    sendEach.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        {success: true},
        {
          success: false,
          error: {
            code: "messaging/registration-token-not-registered",
          },
        },
      ] as never,
    });
    await expect(deliverHazardPush({flagId: "flood-1"})).resolves.toEqual({
      delivered: 1,
      skipped: false,
    });
    expect(fcmTokenRepository.removeTokens).toHaveBeenCalledWith("u1", [
      "dead",
    ]);
  });

  it("delivers removals from task coords without the flag row", async () => {
    process.env.FCM_ENABLED = "true";
    jest.mocked(flagRepository.findById).mockResolvedValue(null);
    jest.mocked(activeRouteRepository.findNearFlag).mockResolvedValue([
      {userId: "u9", geometry: JSON.stringify(crossing)},
    ] as never);
    jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
      userId: "u9",
      tokens: ["u9-token"],
    } as never);
    sendEach.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{success: true} as never],
    });
    await expect(
      deliverHazardPush({
        flagId: "gone",
        type: "FLOOD",
        lat: 10.77,
        lng: 106.68,
        radiusMeters: 200,
        removed: true,
      }),
    ).resolves.toEqual({delivered: 1, skipped: false});
    const messages = sendEach.mock.calls[0][0];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      token: "u9-token",
      data: {flagId: "gone", removed: "true"},
    });
    expect(messages[0].notification?.body).toContain("cleared");
  });

  it("skips removals with missing coords or non-blocking type", async () => {
    process.env.FCM_ENABLED = "true";
    await expect(
      deliverHazardPush({flagId: "gone", removed: true}),
    ).resolves.toEqual({delivered: 0, skipped: true});
    await expect(
      deliverHazardPush({
        flagId: "gone",
        type: "POTHOLE",
        lat: 10.77,
        lng: 106.68,
        removed: true,
      }),
    ).resolves.toEqual({delivered: 0, skipped: true});
    expect(sendEach).not.toHaveBeenCalled();
  });
});
