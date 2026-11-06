type RiderLike = {
  displayName?: unknown;
  email?: unknown;
  phone?: unknown;
  ratingAvg?: unknown;
  ratingCount?: unknown;
};

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

export const riderParty = (
  riderId: string,
  rider: RiderLike | undefined,
  phone: string | null = null,
): Record<string, unknown> | null => {
  const name = nonEmpty(rider?.displayName) ??
    nonEmpty(rider?.email);
  if (riderId === "" || name === null) return null;
  const party: Record<string, unknown> = {
    id: riderId,
    name,
    kind: "RIDER",
  };
  if (phone !== null && phone !== "") party.phone = phone;
  if (typeof rider?.ratingAvg === "number") {
    party.ratingAvg = rider.ratingAvg;
  }
  if (typeof rider?.ratingCount === "number") {
    party.ratingCount = rider.ratingCount;
  }
  return party;
};
