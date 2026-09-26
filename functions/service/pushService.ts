import {messaging} from "../config/firebase";
import {STATUS_FLAGS} from "../constants/status";
import * as flagRepository from "../repository/flagRepository";
import * as activeRouteRepository from "../repository/activeRouteRepository";
import * as fcmTokenRepository from "../repository/fcmTokenRepository";
import {
  BLOCKING_RADIUS_METERS,
  BLOCKING_STATUSES,
  BLOCKING_TYPES,
  DEFAULT_RADIUS_METERS,
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

const radiusFor = (flag: {
  type: string;
  radiusMeters?: number | null;
}): number =>
  (flag.radiusMeters as number | null | undefined) ??
  BLOCKING_RADIUS_METERS[flag.type] ??
  DEFAULT_RADIUS_METERS;

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
  const removedRadius = typeof input.radiusMeters === "number" ?
    input.radiusMeters :
    DEFAULT_RADIUS_METERS;
  const radius = removed ?
    removedRadius :
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
  fcmEnabled,
};
