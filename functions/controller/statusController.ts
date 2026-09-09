import {Request, Response} from "express";
import * as statusService from "../service/statusService";
import {sendSuccess, handleServiceError} from "../utils/response";

const getStatuses = async (_req: Request, res: Response) => {
  try {
    const result = await statusService.getStatuses();
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getStatuses};
