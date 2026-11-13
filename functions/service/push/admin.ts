import {messaging} from "../../config/firebase";
import {ROLE_ADMIN} from "../../constants/roles";
import {STATUS_USER} from "../../constants/status";
import * as pushTokenRepository from
  "../../repository/pushTokenRepository";
import * as userRepository from "../../repository/userRepository";
import {DEAD_TOKEN_CODES, SEND_CHUNK} from "../dispatch/constants";
import {fcmEnabled} from "./service";

type AdminPushInput = {
  event: string;
  title: string;
  body: string;
  refId?: string;
  route?: string;
};

const registerAdminPushToken = async (
  userId: string,
  token: string,
) => pushTokenRepository.registerToken(userId, token);

const unregisterAdminPushToken = async (
  userId: string,
  token: string,
) => pushTokenRepository.unregisterToken(userId, token);

const deliverAdminPush = async (
  input: AdminPushInput,
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const users = await userRepository.findAll();
  const ids = users
    .filter((user) => user.role === ROLE_ADMIN &&
      user.status === STATUS_USER.ACTIVE)
    .map((user) => user.id);
  if (ids.length === 0) return {delivered: 0, skipped: true};
  const records = await pushTokenRepository.findByUserIds(ids);
  const addressed: Array<{userId: string; token: string}> = [];
  for (const userId of ids) {
    for (const token of records.get(userId)?.tokens ?? []) {
      addressed.push({userId, token});
    }
  }
  if (addressed.length === 0) return {delivered: 0, skipped: true};
  let delivered = 0;
  const dead = new Map<string, string[]>();
  for (let i = 0; i < addressed.length; i += SEND_CHUNK) {
    const chunk = addressed.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(chunk.map(({token}) => ({
      token,
      notification: {
        title: input.title,
        body: input.body,
      },
      data: {
        adminEvent: input.event,
        ...(input.refId !== undefined ? {refId: input.refId} : {}),
        ...(input.route !== undefined ? {route: input.route} : {}),
      },
    })));
    delivered += response.successCount ?? 0;
    response.responses.forEach((result, index) => {
      if (!result.success && result.error &&
        DEAD_TOKEN_CODES.has(result.error.code)) {
        const entry = chunk[index];
        if (entry === undefined) return;
        dead.set(entry.userId, [
          ...(dead.get(entry.userId) ?? []),
          entry.token,
        ]);
      }
    });
  }
  for (const [userId, tokens] of dead) {
    await pushTokenRepository.removeTokens(userId, tokens);
  }
  return {delivered, skipped: false};
};

export {
  registerAdminPushToken,
  unregisterAdminPushToken,
  deliverAdminPush,
};
