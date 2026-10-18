import {messaging} from "../config/firebase";
import {STATUS_FLAGS} from "../constants/status";
import * as flagRepository from "../repository/flagRepository";
import * as activeRouteRepository from "../repository/activeRouteRepository";
import * as fcmTokenRepository from "../repository/fcmTokenRepository";
import {
  BLOCKING_STATUSES,
  BLOCKING_TYPES,
  effectiveRadiusMeters,
} from "./closureService";
import {lineStringHitsCircles} from "../utils/geo";

const SEND_CHUNK = 500;
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const fcmEnabled = (): boolean => process.env.FCM_ENABLED === "true";

const registerPushToken = async (userId: string, token: string) =>
  fcmTokenRepository.registerToken(userId, token);

const unregisterPushToken = async (userId: string, token: string) =>
  fcmTokenRepository.unregisterToken(userId, token);

const pingOwnPush = async (
  userId: string,
): Promise<{
  tokens: number;
  sent: number;
  failed: number;
  firstError: string | null;
}> => {
  if (!fcmEnabled()) {
    return {tokens: 0, sent: 0, failed: 0, firstError: "FCM_DISABLED"};
  }
  const record = await fcmTokenRepository.findByUserId(userId);
  const tokens = (record?.tokens as string[] | undefined) ?? [];
  if (tokens.length === 0) {
    return {tokens: 0, sent: 0, failed: 0, firstError: "NO_TOKENS"};
  }
  let sent = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (let i = 0; i < tokens.length; i += SEND_CHUNK) {
    const chunk = tokens.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map((token) => ({
        token,
        notification: {
          title: "RoadAssist test push",
          body: "This is a test notification — tap to dismiss",
        },
        data: {ping: "true"},
      })),
    );
    sent += response.successCount ?? 0;
    const dead: string[] = [];
    response.responses.forEach((r, idx) => {
      if (!r.success) {
        failed += 1;
        const code = r.error?.code ?? "UNKNOWN";
        if (firstError === null) firstError = code;
        if (r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
          const token = chunk[idx];
          if (token !== undefined) dead.push(token);
        }
      }
    });
    if (dead.length > 0) {
      await fcmTokenRepository.removeTokens(userId, dead);
    }
  }
  return {tokens: tokens.length, sent, failed, firstError};
};

const radiusFor = (flag: {
  type: string;
  radiusMeters?: number | null;
}): number =>
  effectiveRadiusMeters(flag.type, flag.radiusMeters);

const deliverHazardPush = async (input: {
  flagId: string;
  type?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  removed?: boolean;
}): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const removed = input.removed === true;
  const flag = removed ? null : await flagRepository.findById(input.flagId);
  if (!flag && !removed) return {delivered: 0, skipped: true};
  const removedType = typeof input.type === "string" ? input.type : "";
  const type = removed ? removedType : (flag as {type: string}).type;
  const status = removed ? "REMOVED" : (flag as {status: string}).status;
  const lat = removed ?
    (input.lat as number) :
    (flag as {lat: number}).lat;
  const lng = removed ?
    (input.lng as number) :
    (flag as {lng: number}).lng;
  const reporterUid = !removed &&
    typeof (flag as {reporterUid?: unknown}).reporterUid === "string" ?
    (flag as {reporterUid: string}).reporterUid :
    "";
  if (
    !removed &&
    (!BLOCKING_TYPES.includes(type) ||
      (!BLOCKING_STATUSES.includes(status) &&
        status !== STATUS_FLAGS.SUGGESTED))
  ) {
    return {delivered: 0, skipped: true};
  }
  if (
    removed &&
    (typeof lat !== "number" ||
      typeof lng !== "number" ||
      !BLOCKING_TYPES.includes(type))
  ) {
    return {delivered: 0, skipped: true};
  }
  const radius = removed ?
    effectiveRadiusMeters(type, input.radiusMeters) :
    radiusFor(flag as {type: string; radiusMeters?: number | null});
  const routes = await activeRouteRepository.findNearFlag(
    lat,
    lng,
    radius,
  );
  const userIds = new Set<string>();
  for (const route of routes) {
    let geometry = route.geometry;
    if (typeof geometry === "string") {
      try {
        geometry = JSON.parse(geometry);
      } catch {
        continue;
      }
    }
    const hits = lineStringHitsCircles(geometry, [
      {lat, lng, radiusMeters: radius},
    ]);
    if (
      hits.length > 0 &&
      typeof route.userId === "string" &&
      route.userId !== reporterUid
    ) {
      userIds.add(route.userId);
    }
  }
  const targets: Array<{userId: string; token: string}> = [];
  for (const userId of userIds) {
    const record = await fcmTokenRepository.findByUserId(userId);
    for (const token of (record?.tokens as string[] | undefined) ?? []) {
      targets.push({userId, token});
    }
  }
  let delivered = 0;
  const confirmed = !removed && status !== STATUS_FLAGS.SUGGESTED;
  const body = removed ?
    `${type} cleared — tap to view` :
    confirmed ?
      `${type} confirmed ahead — tap to view` :
      `${type} reported ahead — tap to view`;
  for (let i = 0; i < targets.length; i += SEND_CHUNK) {
    const chunk = targets.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map(({token}) => ({
        token,
        notification: {
          title: "Road hazard on your route",
          body,
        },
        android: {
          priority: "high",
          notification: {channelId: "hazard", sound: "default"},
        },
        data: {
          flagId: input.flagId,
          type,
          status,
          lat: String(lat),
          lng: String(lng),
          radiusMeters: String(radius),
          ...(removed ? {removed: "true"} : {}),
        },
      })),
    );
    delivered += response.successCount ?? 0;
    const dead = new Map<string, string[]>();
    response.responses.forEach((r, idx) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
        const {userId, token} = chunk[idx];
        dead.set(userId, [...(dead.get(userId) ?? []), token]);
      }
    });
    for (const [userId, tokens] of dead) {
      await fcmTokenRepository.removeTokens(userId, tokens);
    }
  }
  return {delivered, skipped: false};
};

export {
  registerPushToken,
  unregisterPushToken,
  deliverHazardPush,
  pingOwnPush,
  fcmEnabled,
};
