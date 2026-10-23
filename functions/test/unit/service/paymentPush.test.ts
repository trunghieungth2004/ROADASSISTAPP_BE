import {messaging} from "../../../config/firebase";
import * as fcmTokenRepository from "../../../repository/fcmTokenRepository";
import * as userRepository from "../../../repository/userRepository";
import * as pushService from "../../../service/pushService";
import {
  deliverOpened,
  deliverPayout,
  deliverReceived,
} from "../../../service/paymentPush";

jest.mock("../../../repository/fcmTokenRepository");
jest.mock("../../../repository/userRepository");
jest.mock("../../../service/pushService", () => ({fcmEnabled: jest.fn()}));

const payment = {
  id: "pay1",
  ticketId: "t1",
  riderUid: "rider1",
  payeeId: "payee1",
  amount: 100000,
  method: "CASH",
  refundAmount: null,
};

const batch = {
  id: "b1",
  payeeId: "payee1",
  net: 90000,
  paymentIds: ["pay1"],
  ticketIds: ["t1"],
};

const successfulSend = (count = 1) => ({
  successCount: count,
  failureCount: 0,
  responses: Array.from({length: count}, () => ({success: true})),
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(userRepository.findById).mockResolvedValue({
    id: "payee1",
    role: "2",
  });
  jest.mocked(fcmTokenRepository.findByUserId).mockResolvedValue({
    tokens: ["token-1"],
  } as never);
});

describe("payment push", () => {
  it("stays quiet when FCM is disabled", async () => {
    jest.mocked(pushService.fcmEnabled).mockReturnValue(false);
    const result = await deliverOpened(payment);
    expect(result).toEqual({delivered: 0, skipped: true});
    expect(messaging.sendEach).not.toHaveBeenCalled();
  });

  it("respects a disabled payment preference", async () => {
    jest.mocked(pushService.fcmEnabled).mockReturnValue(true);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "payee1",
      role: "2",
      notificationPrefs: {paymentUpdates: false, payoutUpdates: true},
    });
    const result = await deliverOpened(payment);
    expect(result.skipped).toBe(true);
    expect(messaging.sendEach).not.toHaveBeenCalled();
  });

  it("sends a deep-linkable payment notice", async () => {
    jest.mocked(pushService.fcmEnabled).mockReturnValue(true);
    jest.mocked(messaging.sendEach).mockResolvedValue(
      successfulSend() as never);
    const result = await deliverOpened(payment);
    expect(result).toEqual({delivered: 1, skipped: false});
    const messages = jest.mocked(messaging.sendEach).mock.calls[0][0];
    expect(messages[0].notification?.title).toBe("New payment");
    expect(messages[0].data).toMatchObject({
      screen: "payments",
      event: "PAYMENT_OPENED",
      paymentId: "pay1",
      ticketId: "t1",
    });
    expect(messages[0].android?.notification?.channelId).toBe("payments");
  });

  it("notifies the payee when an online payment lands", async () => {
    jest.mocked(pushService.fcmEnabled).mockReturnValue(true);
    jest.mocked(messaging.sendEach).mockResolvedValue(
      successfulSend() as never);
    await deliverReceived({...payment, method: "SEPAY"});
    const messages = jest.mocked(messaging.sendEach).mock.calls[0][0];
    expect(messages[0].data?.event).toBe("PAYMENT_RECEIVED");
  });

  it("gates payout notices behind the payout preference", async () => {
    jest.mocked(pushService.fcmEnabled).mockReturnValue(true);
    jest.mocked(messaging.sendEach).mockResolvedValue(
      successfulSend() as never);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "payee1",
      role: "2",
      notificationPrefs: {paymentUpdates: true, payoutUpdates: false},
    });
    const result = await deliverPayout(batch);
    expect(result.skipped).toBe(true);
    jest.mocked(userRepository.findById).mockResolvedValue({
      id: "payee1",
      role: "2",
    });
    await deliverPayout(batch);
    const messages = jest.mocked(messaging.sendEach).mock.calls[0][0];
    expect(messages[0].data).toMatchObject({
      event: "PAYOUT_SETTLED",
      payoutId: "b1",
      ticketId: "t1",
    });
  });

  it("drops dead tokens after a failed send", async () => {
    jest.mocked(pushService.fcmEnabled).mockReturnValue(true);
    jest.mocked(messaging.sendEach).mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [{
        success: false,
        error: {code: "messaging/registration-token-not-registered"},
      }],
    } as never);
    await deliverOpened(payment);
    expect(fcmTokenRepository.removeTokens).toHaveBeenCalledWith(
      "payee1",
      ["token-1"],
    );
  });
});
