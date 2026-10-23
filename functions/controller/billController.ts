import {Request, Response} from "express";
import * as billService from "../service/billService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const listAll = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {limit} = req.body;
    const result = await billService.listBills({userId: uid, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listPayee = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {limit} = req.body;
    const result = await billService.listPayeeBills({userId: uid, limit});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getOne = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {ticketId, billId, scope} = req.body;
    const result = await billService.getBill({
      userId: uid,
      ticketId,
      billId,
      scope,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {listAll, listPayee, getOne};
