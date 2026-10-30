import {
  CHAT_PHOTO_PREFIX,
  FLAG_PHOTO_PREFIX,
  PHOTO_MAX_COUNT,
  PHOTO_PARENT_SEGMENT,
  PHOTO_PATH_SEGMENT,
  PHOTO_SCHEME_PREFIX,
} from "../constants/media";
import {storage} from "../config/firebase";
import {ValidationError} from "./errors";

const sanitizePhotoPath = (path: string): string =>
  path.trim().replace(/\/{2,}/g, "/");

const isPhotoPathSegment = (value: string): boolean =>
  PHOTO_PATH_SEGMENT.test(value);

const assertPhotoPath = (path: unknown): string => {
  if (typeof path !== "string") {
    throw new ValidationError("Photo path must be a string");
  }
  const clean = sanitizePhotoPath(path);
  if (
    clean === "" ||
    clean.startsWith("/") ||
    clean.includes(PHOTO_PARENT_SEGMENT) ||
    clean.startsWith(PHOTO_SCHEME_PREFIX)
  ) {
    throw new ValidationError("Photo path is invalid");
  }
  return clean;
};

const validatePhotoPathsStructure = (paths?: string[]): string[] => {
  if (paths === undefined) return [];
  if (!Array.isArray(paths) || paths.length > PHOTO_MAX_COUNT) {
    throw new ValidationError("Too many photos");
  }
  return paths.map((path) => assertPhotoPath(path));
};

const scopeSegment = ({
  ownerUid,
  prefix,
  ticketId,
  chatId,
}: {
  ownerUid: string;
  prefix: string;
  ticketId?: string;
  chatId?: string;
}): string => {
  if (prefix === FLAG_PHOTO_PREFIX) return ownerUid;
  if (prefix === CHAT_PHOTO_PREFIX) return chatId ?? "";
  return ticketId ?? "";
};

const validatePhotoPaths = ({
  paths,
  ownerUid,
  prefix,
  ticketId,
  chatId,
}: {
  paths?: string[];
  ownerUid: string;
  prefix: string;
  ticketId?: string;
  chatId?: string;
}): string[] => {
  const clean = validatePhotoPathsStructure(paths);
  if (clean.length === 0) return clean;
  const scope = scopeSegment({ownerUid, prefix, ticketId, chatId});
  if (!isPhotoPathSegment(scope)) {
    throw new ValidationError("Photo scope is invalid");
  }
  const required = `${prefix}/${scope}/`;
  for (const path of clean) {
    if (!path.startsWith(required)) {
      throw new ValidationError("Photo path is outside its scope");
    }
  }
  return clean;
};

const deleteObjects = async (paths: string[]): Promise<void> => {
  try {
    const targets = Array.isArray(paths) ?
      paths.filter((path) => typeof path === "string" && path !== "") :
      [];
    if (targets.length === 0) return;
    const bucket = storage.bucket();
    await Promise.all(
      targets.map(async (path) => {
        try {
          await bucket.file(path).delete({ignoreNotFound: true});
        } catch {
          return;
        }
      }),
    );
  } catch {
    return;
  }
};

export {
  sanitizePhotoPath,
  isPhotoPathSegment,
  validatePhotoPathsStructure,
  validatePhotoPaths,
  deleteObjects,
};
