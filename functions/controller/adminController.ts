import {Request, Response} from "express";
import * as adminService from "../service/adminService";
import * as platformConfigService from "../service/platformConfigService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const getConfig = async (_req: Request, res: Response) => {
  try {
    const result = await platformConfigService.getConfig();
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateConfig = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const result = await platformConfigService.updateConfig(
      (req.body ?? {}) as Record<string, unknown>,
      uid,
    );
    sendSuccess(res, result, {message: "Platform config updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const payout = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {paymentId} = req.body;
    const result = await adminService.payout({paymentId, adminUid: uid});
    sendSuccess(res, result, {message: "Payout recorded"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getConfig, updateConfig, payout};
