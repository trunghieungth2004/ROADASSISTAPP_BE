import {Request, Response} from "express";
import * as warrantyService from "../service/warrantyService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const file = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {ticketId, lineId, reason, photoUrls} = req.body;
    const result = await warrantyService.fileClaim({
      userId: uid,
      ticketId,
      lineId,
      reason,
      photoUrls,
    });
    sendSuccess(res, result, {statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const mine = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {limit} = req.body ?? {};
    sendSuccess(res, await warrantyService.myClaims({userId: uid, limit}));
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const shop = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {providerId, limit} = req.body ?? {};
    sendSuccess(res, await warrantyService.shopClaims({
      userId: uid,
      providerId,
      limit,
    }));
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const respond = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {claimId, accept, note} = req.body;
    sendSuccess(res, await warrantyService.respond({
      userId: uid,
      claimId,
      accept,
      note,
    }));
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const dispute = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {claimId, note} = req.body;
    sendSuccess(res, await warrantyService.dispute({
      userId: uid,
      claimId,
      note,
    }));
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const list = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {status, limit} = req.body ?? {};
    sendSuccess(res, await warrantyService.listClaims({
      adminUid: uid,
      status,
      limit,
    }));
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const resolve = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {claimId, outcome, refundAmount, note} = req.body;
    sendSuccess(res, await warrantyService.resolve({
      adminUid: uid,
      claimId,
      outcome,
      refundAmount,
      note,
    }));
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {file, mine, shop, respond, dispute, list, resolve};
