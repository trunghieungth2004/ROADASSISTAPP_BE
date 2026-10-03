import * as providerRepository from "../repository/providerRepository";
import * as landmarkRepository from "../repository/landmarkRepository";

export type DirectoryPlace = {
  kind: "shop" | "landmark";
  id: string;
  label: string;
  lat: number;
  lng: number;
  type?: string;
};

import {ValidationError} from "../utils/errors";

const DEFAULT_LIMIT = 5;

const searchDirectory = async ({
  q,
  limit = DEFAULT_LIMIT,
}: {
  q: string;
  limit?: number;
}): Promise<DirectoryPlace[]> => {
  const query = q.trim();
  if (!query) throw new ValidationError("Search query is required");
  const [shops, landmarks] = await Promise.all([
    providerRepository.findByNamePrefix(query, limit),
    landmarkRepository.findByLabelPrefix(query, limit),
  ]);
  const live = shops.filter((s) => s.status === "ACTIVE" &&
    (s as {suspended?: boolean}).suspended !== true);
  return [
    ...live.map((s) => ({
      kind: "shop" as const,
      id: s.id,
      label: s.name,
      lat: s.lat,
      lng: s.lng,
      type: s.kind,
    })),
    ...landmarks.map((l) => ({
      kind: "landmark" as const,
      id: l.id,
      label: l.displayLabel,
      lat: l.lat,
      lng: l.lng,
    })),
  ];
};

export {searchDirectory, ValidationError};
