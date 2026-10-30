import {Request, Response} from "express";
import * as disputeService from "../service/disputeService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const file = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {
      ticketId,
      accusedId,
      accusedKind,
      type,
      reasonCode,
      reason,
      note,
      photoUrls,
      photoUrl,
    } = req.body;
    const photos = [
      ...(Array.isArray(photoUrls) ? photoUrls : []),
      ...(typeof photoUrl === "string" && photoUrl !== "" ? [photoUrl] : []),
    ];
    const result = await disputeService.userFile({
      ticketId,
      filedBy: uid,
      accusedId,
      accusedKind,
      type,
      reasonCode,
      reason,
      note,
      photoUrls: photos,
    });
    sendSuccess(res, result, {message: "Dispute filed", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const one = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {disputeId} = req.body;
    const result = await disputeService.one({disputeId, userId: uid});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listAll = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {status, limit} = req.body;
    const result = await disputeService.list({
      adminUid: uid,
      status,
      limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const resolve = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {
      disputeId,
      resolution,
      outcome,
      adjustedAmount,
      refundAdjust,
      payoutAdjust,
    } = req.body;
    const result = await disputeService.resolve({
      disputeId,
      resolution,
      by: uid,
      outcome,
      adjustedAmount,
      refundAdjust,
      payoutAdjust,
    });
    sendSuccess(res, result, {message: "Dispute resolved"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {file, one, listAll, resolve};
