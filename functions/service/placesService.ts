import * as shopRepository from "../repository/shopRepository";
import * as landmarkRepository from "../repository/landmarkRepository";

export type DirectoryPlace = {
  kind: "shop" | "landmark";
  id: string;
  label: string;
  lat: number;
  lng: number;
  type?: string;
};

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

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
    shopRepository.findByNamePrefix(query, limit),
    landmarkRepository.findByLabelPrefix(query, limit),
  ]);
  return [
    ...shops.map((s) => ({
      kind: "shop" as const,
      id: s.id,
      label: s.name,
      lat: s.lat,
      lng: s.lng,
      type: s.type,
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
