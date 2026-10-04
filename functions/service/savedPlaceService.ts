import * as savedPlaceRepository from "../repository/savedPlaceRepository";
import * as cacheManager from "../utils/cacheManager";

export type SavedPlace = savedPlaceRepository.SavedPlace;

import {ForbiddenError, NotFoundError, ValidationError} from
  "../utils/errors";

const MAX_SAVED_PLACES = 50;

const NS = "savedPlace";

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
      cacheManager.del(NS, userId);
    }
    return existing;
  }
  const count = await savedPlaceRepository.countByUserId(userId);
  if (count >= MAX_SAVED_PLACES) {
    throw new ValidationError(
      `You can save at most ${MAX_SAVED_PLACES} places`,
    );
  }
  const created = await savedPlaceRepository.create(
    {userId, label: name, lat, lng});
  cacheManager.del(NS, userId);
  return created;
};

const listSavedPlacesInner = async (userId: string): Promise<SavedPlace[]> =>
  savedPlaceRepository.listByUserId(userId);

const listSavedPlacesCached = cacheManager.wrap(listSavedPlacesInner, {
  namespace: NS,
  keyFn: (userId: string) => userId,
});

const listSavedPlaces = async (userId: string): Promise<SavedPlace[]> =>
  listSavedPlacesCached(userId);

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
  cacheManager.del(NS, userId);
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
