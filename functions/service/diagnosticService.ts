import * as diagnosticRepository from "../repository/diagnosticRepository";

import {NotFoundError} from "../utils/errors";

const createDiagnostic = async (data: {
  userId: string;
  category: string;
  imagePath: string;
}) => diagnosticRepository.create(data);

const getDiagnostic = async (id: string) => {
  const diag = await diagnosticRepository.findById(id);
  if (!diag) throw new NotFoundError("Diagnostic not found");
  return diag;
};

export {createDiagnostic, getDiagnostic, NotFoundError};
