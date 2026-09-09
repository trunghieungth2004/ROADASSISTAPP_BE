import {Request, Response} from "express";
import * as dispatchService from "../service/dispatchService";
import {sendSuccess, handleServiceError} from "../utils/response";

const createDispatch = async (req: Request, res: Response) => {
  try {
    const {userId, ticketType, lat, lng, diagnosticId} = req.body;
    const result = await dispatchService.createDispatch({
      userId,
      ticketType,
      lat,
      lng,
      diagnosticId,
    });
    sendSuccess(res, result, {message: "Dispatch created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getDispatch = async (req: Request, res: Response) => {
  try {
    const {ticketId} = req.body;
    const result = await dispatchService.getDispatch(ticketId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateDispatchStatus = async (req: Request, res: Response) => {
  try {
    const {ticketId, status} = req.body;
    const result = await dispatchService.updateDispatchStatus({
      id: ticketId,
      status,
    });
    sendSuccess(res, result, {message: "Dispatch updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createDispatch, getDispatch, updateDispatchStatus};
