import {Request, Response} from "express";
import * as supportService from "../service/supportService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const create = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await supportService.createTicket({...req.body, userId});
    sendSuccess(res, result, {
      message: "Support request sent",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const mine = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await supportService.myTickets({userId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const adminList = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await supportService.adminList({
      userId,
      ...(typeof req.body.status === "string" ? {status: req.body.status} : {}),
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const respond = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await supportService.respond({...req.body, userId});
    sendSuccess(res, result, {message: "Support reply sent"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {create, mine, adminList, respond};
