import {messaging} from "../config/firebase";
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

const deliverHazardPush = async (
  flagId: string,
): Promise<{delivered: number; skipped: boolean}> => {
  if (!fcmEnabled()) return {delivered: 0, skipped: true};
  const flag = await flagRepository.findById(flagId);
  if (!flag) return {delivered: 0, skipped: true};
  if (
    !BLOCKING_TYPES.includes(flag.type) ||
    !BLOCKING_STATUSES.includes(flag.status)
  ) {
    return {delivered: 0, skipped: true};
  }
  const radius = radiusFor(flag);
  const routes = await activeRouteRepository.findNearFlag(
    flag.lat,
    flag.lng,
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
      {lat: flag.lat, lng: flag.lng, radiusMeters: radius},
    ]);
    if (hits.length > 0 && typeof route.userId === "string") {
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
  for (let i = 0; i < targets.length; i += SEND_CHUNK) {
    const chunk = targets.slice(i, i + SEND_CHUNK);
    const response = await messaging.sendEach(
      chunk.map(({token}) => ({
        token,
        notification: {
          title: "Road hazard on your route",
          body: `${flag.type} reported ahead — tap to view`,
        },
        data: {
          flagId: flag.id,
          type: flag.type,
          status: flag.status,
          lat: String(flag.lat),
          lng: String(flag.lng),
          radiusMeters: String(radius),
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
