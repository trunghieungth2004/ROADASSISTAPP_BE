import {Request, Response} from "express";
import * as diagnosticService from "../service/diagnosticService";
import {sendSuccess, handleServiceError} from "../utils/response";

const createDiagnostic = async (req: Request, res: Response) => {
  try {
    const {userId, category, imagePath} = req.body;
    const result = await diagnosticService.createDiagnostic({
      userId,
      category,
      imagePath,
    });
    sendSuccess(res, result, {
      message: "Diagnostic created",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getDiagnostic = async (req: Request, res: Response) => {
  try {
    const {diagnosticId} = req.body;
    const result = await diagnosticService.getDiagnostic(diagnosticId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createDiagnostic, getDiagnostic};
