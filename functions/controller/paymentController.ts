import {Request, Response} from "express";
import * as paymentService from "../service/paymentService";
import * as sepayService from "../service/sepayService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";
import {ForbiddenError} from "../utils/errors";

const createPayment = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {ticketId, method} = req.body;
    const result = await paymentService.createPaymentForTicket({
      userId: uid,
      ticketId,
      method,
    });
    sendSuccess(res, result, {message: "Payment created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const ipn = async (req: Request, res: Response) => {
  try {
    const headers = req.headers as Record<string, unknown>;
    if (!sepayService.verifyIpnAuth(headers)) {
      throw new ForbiddenError("Invalid SePay authorization");
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await paymentService.handleSepayIpn(body, headers);
    sendSuccess(res, result, {message: "IPN recorded"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const confirmCash = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await paymentService.confirmCash({userId: uid, ticketId});
    sendSuccess(res, result, {message: "Cash payment confirmed"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getOne = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await paymentService.getPaymentForTicket({
      userId: uid,
      ticketId,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listAll = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {status, limit} = req.body;
    const result = await paymentService.listPayments({
      adminUid: uid,
      status,
      limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createPayment, ipn, confirmCash, getOne, listAll};
