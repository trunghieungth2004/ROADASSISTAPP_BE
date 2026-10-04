import * as dispatchRepository from
  "../../repository/dispatchRepository";
import * as userRepository from "../../repository/userRepository";
import * as volunteerLocationRepository from
  "../../repository/volunteerLocationRepository";
import {
  boundsForRadiusMeters,
  cellsCoveringBounds,
  haversineMeters,
} from "../../utils/geo";
import {
  VOLUNTEER_DEFAULT_RADIUS,
  VOLUNTEER_FRESH_MS,
} from "../../constants/status";
import {volunteerFitsTicket} from "./helpers";

export const findCandidates = async ({
  lat,
  lng,
  radiusMeters = VOLUNTEER_DEFAULT_RADIUS,
  vehicleType,
}: {
  lat: number;
  lng: number;
  radiusMeters?: number;
  vehicleType?: string;
}): Promise<string[]> => {
  const bounds = boundsForRadiusMeters(lat, lng, radiusMeters);
  const cells = cellsCoveringBounds(bounds, 6);
  const locations =
    await volunteerLocationRepository.findByGeohashPrefixes(cells);
  const cutoff = Date.now() - VOLUNTEER_FRESH_MS;
  const fresh = locations.filter((loc) => {
    if (Date.parse(loc.lastSeen) < cutoff) return false;
    return haversineMeters(lat, lng, loc.lat, loc.lng) <= radiusMeters;
  });
  if (fresh.length === 0) return [];
  const users = await userRepository.findByIds(
    fresh.map((loc) => loc.uid),
  );
  const eligible: string[] = [];
  for (const loc of fresh) {
    const user = users.get(loc.uid);
    if (!user) continue;
    if (user.volunteerAvailable !== true) continue;
    if (user.status && user.status !== "1") continue;
    if (!volunteerFitsTicket(user.capability, vehicleType)) continue;
    eligible.push(loc.uid);
  }
  const free: string[] = [];
  const busy = await dispatchRepository.findBusyUids(eligible);
  for (const uid of eligible) {
    if (!busy.has(uid)) free.push(uid);
  }
  return free;
};
