import * as savedPlaceRepository from "../repository/savedPlaceRepository";

export type SavedPlace = savedPlaceRepository.SavedPlace;

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 404) {
    super(message);
    this.statusCode = statusCode;
  }
}

class ForbiddenError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_SAVED_PLACES = 50;

const savePlace = async ({
  userId,
  label,
  lat,
  lng,
}: {
  userId: string;
  label: string;
  lat: number;
  lng: number;
}): Promise<SavedPlace> => {
  const name = label.trim();
  if (!name) throw new ValidationError("Place label is required");
  const existing = await savedPlaceRepository.findByCoords(userId, lat, lng);
  if (existing) {
    if (existing.label !== name) {
      await savedPlaceRepository.updateLabel(existing.id, name);
      existing.label = name;
    }
    return existing;
  }
  const count = await savedPlaceRepository.countByUserId(userId);
  if (count >= MAX_SAVED_PLACES) {
    throw new ValidationError(
      `You can save at most ${MAX_SAVED_PLACES} places`,
    );
  }
  return savedPlaceRepository.create({userId, label: name, lat, lng});
};

const listSavedPlaces = async (userId: string): Promise<SavedPlace[]> =>
  savedPlaceRepository.listByUserId(userId);

const removeSavedPlace = async ({
  userId,
  placeId,
}: {
  userId: string;
  placeId: string;
}): Promise<{deleted: number}> => {
  const record = await savedPlaceRepository.findById(placeId);
  if (!record) throw new NotFoundError("Saved place not found");
  if (record.userId !== userId) {
    throw new ForbiddenError("You can only remove your own saved places");
  }
  await savedPlaceRepository.deleteById(placeId);
  return {deleted: 1};
};

export {
  savePlace,
  listSavedPlaces,
  removeSavedPlace,
  MAX_SAVED_PLACES,
  ValidationError,
  NotFoundError,
  ForbiddenError,
};
