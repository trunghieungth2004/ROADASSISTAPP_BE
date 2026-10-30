import {messaging} from "../../config/firebase";
import {
  DEAD_TOKEN_CODES,
  SEND_CHUNK,
} from "../dispatch/constants";
import * as fcmTokenRepository from "../../repository/fcmTokenRepository";
import * as userRepository from "../../repository/userRepository";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_PREFS_FIELD,
  PAYMENT_PUSH_EVENT,
} from "../../constants/notifications";
import {
  PAYMENT_CURRENCY,
  PAYMENT_METHOD,
} from "../../constants/payments";
import {fcmEnabled} from "./service";
import {prefsFor} from "../notificationService";

type PushResult = {delivered: number; skipped: boolean};

type PaymentLike = {
  id: string;
  ticketId: string;
  riderUid: string;
  payeeId: string;
  amount: number;
  method: string;
  refundAmount?: number | null;
  [key: string]: unknown;
};

type PayoutLike = {
  id: string;
  payeeId: string;
  net: number;
  paymentIds: string[];
  ticketIds?: string[];
  [key: string]: unknown;
};

type Gate = "paymentUpdates" | "payoutUpdates";

const skipped = (): PushResult => ({delivered: 0, skipped: true});

const money = (amount: number): string =>
  `${new Intl.NumberFormat("vi-VN").format(amount)} ${PAYMENT_CURRENCY}`;

const sendPush = async (
  userId: string,
  gate: Gate,
  notice: {
    title: string;
    body: string;
    event: string;
    paymentId: string;
    ticketId: string;
    payoutId?: string;
  },
): Promise<PushResult> => {
  if (!fcmEnabled()) return skipped();
  const user = await userRepository.findById(userId);
  if (!user) return skipped();
  if (!prefsFor(user[NOTIFICATION_PREFS_FIELD])[gate]) return skipped();
  const record = await fcmTokenRepository.findByUserId(userId);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  if (tokens.length === 0) return skipped();
  let delivered = 0;
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += SEND_CHUNK) {
    const chunk = tokens.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((token) => ({
        token,
        notification: {title: notice.title, body: notice.body},
        android: {
          priority: "high",
          notification: {
            channelId: NOTIFICATION_CHANNEL,
            sound: "default",
          },
        },
        data: {
          screen: "payments",
          event: notice.event,
          paymentId: notice.paymentId,
          ticketId: notice.ticketId,
          ...(notice.payoutId === undefined ? {} : {payoutId: notice.payoutId}),
        },
      })),
    );
    delivered += response.successCount ?? 0;
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const token = chunk[idx];
        if (token !== undefined) dead.push(token);
      }
    });
  }
  if (dead.length > 0) await fcmTokenRepository.removeTokens(userId, dead);
  return {delivered, skipped: false};
};

const deliverOpened = async (payment: PaymentLike): Promise<PushResult> => {
  if (payment.riderUid === payment.payeeId) return skipped();
  const online = "A rider opened an online payment of " +
    `${money(payment.amount)} — tap to view`;
  const body = payment.method === PAYMENT_METHOD.CASH ?
    `A rider will pay ${money(payment.amount)} in cash — tap to view` :
    online;
  return sendPush(payment.payeeId, "paymentUpdates", {
    title: "New payment",
    body,
    event: PAYMENT_PUSH_EVENT.OPENED,
    paymentId: payment.id,
    ticketId: payment.ticketId,
  });
};

const deliverReceived = async (payment: PaymentLike): Promise<PushResult> => {
  if (payment.riderUid === payment.payeeId) return skipped();
  return sendPush(payment.payeeId, "paymentUpdates", {
    title: "Payment received",
    body: `${money(payment.amount)} was paid online — tap to view`,
    event: PAYMENT_PUSH_EVENT.RECEIVED,
    paymentId: payment.id,
    ticketId: payment.ticketId,
  });
};

const deliverConfirmed = async (payment: PaymentLike): Promise<PushResult> =>
  sendPush(payment.riderUid, "paymentUpdates", {
    title: "Cash payment confirmed",
    body: `Your ${money(payment.amount)} cash payment was confirmed`,
    event: PAYMENT_PUSH_EVENT.CONFIRMED,
    paymentId: payment.id,
    ticketId: payment.ticketId,
  });

const deliverRefunded = async (payment: PaymentLike): Promise<PushResult> => {
  const amount = typeof payment.refundAmount === "number" ?
    payment.refundAmount :
    payment.amount;
  return sendPush(payment.riderUid, "paymentUpdates", {
    title: "Refund issued",
    body: `${money(amount)} was refunded — tap to view`,
    event: PAYMENT_PUSH_EVENT.REFUNDED,
    paymentId: payment.id,
    ticketId: payment.ticketId,
  });
};

const deliverPayout = async (batch: PayoutLike): Promise<PushResult> =>
  sendPush(batch.payeeId, "payoutUpdates", {
    title: "Payout sent",
    body: `${money(batch.net)} payout is on the way`,
    event: PAYMENT_PUSH_EVENT.PAYOUT,
    paymentId: batch.paymentIds[0] ?? "",
    ticketId: batch.ticketIds?.[0] ?? "",
    payoutId: batch.id,
  });

export {
  PushResult,
  deliverOpened,
  deliverReceived,
  deliverConfirmed,
  deliverRefunded,
  deliverPayout,
};
