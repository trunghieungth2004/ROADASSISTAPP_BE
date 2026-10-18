import * as diagnosticRepository from "../repository/diagnosticRepository";

import {ForbiddenError, NotFoundError} from "../utils/errors";

const scopedPrefix = (userId: string): string =>
  `diagnostics/${userId}/`;

const toScopedImagePath = (userId: string, imagePath: string): string => {
  const prefix = scopedPrefix(userId);
  if (imagePath.startsWith(prefix)) return imagePath;
  if (
    imagePath.includes("..") ||
    imagePath.startsWith("/") ||
    imagePath.startsWith("diagnostics/")
  ) {
    throw new ForbiddenError("Image path is outside the user folder");
  }
  return `${prefix}${imagePath.replace(/^\/+/, "")}`;
};

const createDiagnostic = async (data: {
  userId: string;
  category: string;
  imagePath: string;
}) => diagnosticRepository.create({
  userId: data.userId,
  category: data.category,
  imagePath: toScopedImagePath(data.userId, data.imagePath),
});

const getDiagnostic = async (id: string, userId: string) => {
  const diag = await diagnosticRepository.findById(id);
  if (!diag) throw new NotFoundError("Diagnostic not found");
  if (diag.userId !== userId) throw new ForbiddenError("Access denied");
  return diag;
};

export {createDiagnostic, getDiagnostic, NotFoundError};
