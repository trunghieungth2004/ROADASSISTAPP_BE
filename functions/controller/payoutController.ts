import {Request, Response} from "express";
import * as payoutService from "../service/payoutService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const mine = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {limit} = req.body ?? {};
    const result = await payoutService.myPayouts({userId: uid, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const banks = async (_req: Request, res: Response) => {
  sendSuccess(res, payoutService.listBanks());
};

const getAccount = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const account = await payoutService.getAccount(uid);
    sendSuccess(res, account);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const setAccount = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {bankCode, accountNumber, holderName} = req.body;
    const account = await payoutService.setAccount({
      userId: uid,
      bankCode,
      accountNumber,
      holderName,
    });
    sendSuccess(res, account);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const request = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {amount, note} = req.body;
    const created = await payoutService.requestPayout({
      userId: uid,
      amount,
      note,
    });
    sendSuccess(res, created, {statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const requests = async (req: Request, res: Response) => {
  try {
    const {status, limit} = req.body ?? {};
    const rows = await payoutService.listRequests({status, limit});
    sendSuccess(res, rows);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const decideRequest = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {requestId, approve, note, payoutRef} = req.body;
    const result = await payoutService.decideRequest({
      adminUid: uid,
      requestId,
      approve,
      note,
      payoutRef,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const statement = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {from, to} = req.body ?? {};
    const result = await payoutService.statement({userId: uid, from, to});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const settleCommission = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {payeeId} = req.body;
    const result = await payoutService.settleCommission({
      adminUid: uid,
      payeeId,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  mine,
  banks,
  getAccount,
  setAccount,
  request,
  requests,
  decideRequest,
  settleCommission,
  statement,
};
