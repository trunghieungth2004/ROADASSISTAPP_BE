import {messaging} from "../../config/firebase";
import * as fcmTokenRepository from "../../repository/fcmTokenRepository";
import {fcmEnabled} from "./service";

const SEND_CHUNK = 500;
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const sendBookingPush = async (
  userId: string,
  notice: {
    title: string;
    body: string;
    event: string;
    bookingId: string;
  },
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const record = await fcmTokenRepository.findByUserId(userId);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  if (tokens.length === 0) return {delivered: 0, skipped: true};
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
          notification: {channelId: "dispatch", sound: "default"},
        },
        data: {
          screen: "bookings",
          event: notice.event,
          bookingId: notice.bookingId,
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

export {sendBookingPush};
