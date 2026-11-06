import {Request, Response} from "express";
import * as refundService from "../service/refundService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const request = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {paymentId, amount, reason} = req.body;
    const result = await refundService.requestRefund({
      paymentId,
      requestedBy: uid,
      ...(typeof amount === "number" ? {amount} : {}),
      ...(typeof reason === "string" ? {reason} : {}),
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
    const result = await refundService.myRefunds({userId: uid, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const list = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {status, limit} = req.body ?? {};
    const result = await refundService.listRefunds({
      adminUid: uid,
      status,
      limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const decide = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {refundId, approve, note} = req.body;
    const result = await refundService.decideRefund({
      adminUid: uid,
      refundId,
      approve,
      note,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const send = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {refundId, transferRef} = req.body;
    const result = await refundService.markRefundSent({
      adminUid: uid,
      refundId,
      transferRef,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const confirm = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {refundId, transferRef} = req.body;
    const result = await refundService.confirmRefund({
      adminUid: uid,
      refundId,
      transferRef,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const fail = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {refundId, reason} = req.body;
    const result = await refundService.failRefund({
      adminUid: uid,
      refundId,
      reason,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {request, mine, list, decide, send, confirm, fail};
