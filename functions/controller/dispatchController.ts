import {Request, Response} from "express";
import * as dispatchService from "../service/dispatchService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const createDispatch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {
      ticketType,
      lat,
      lng,
      diagnosticId,
      alleySegmentId,
      accessWidthMeters,
      note,
      destinationShopId,
      destinationPoint,
      vehicleType,
      vehicleWidth,
    } = req.body;
    const result = await dispatchService.createDispatch({
      userId,
      ticketType,
      lat,
      lng,
      diagnosticId,
      alleySegmentId,
      accessWidthMeters,
      note,
      destinationShopId,
      destinationPoint,
      vehicleType,
      vehicleWidth,
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

const nearDispatch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {lat, lng, radiusMeters, ticketType} = req.body;
    const result = await dispatchService.nearDispatch({
      userId,
      lat,
      lng,
      radiusMeters,
      ticketType,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const dispatchOffers = async (req: Request, res: Response) => {
  try {
    const {lat, lng, radiusMeters, kind, limit, accessWidthMeters} =
      req.body;
    const result = await dispatchService.dispatchOffers({
      lat,
      lng,
      radiusMeters,
      kind,
      limit,
      accessWidthMeters,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const selectDispatch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, shopId} = req.body;
    const result = await dispatchService.selectDispatch({
      userId,
      ticketId,
      shopId,
    });
    sendSuccess(res, result, {message: "Provider selected"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const acceptDispatch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, shopId} = req.body;
    const result = await dispatchService.acceptDispatch({
      userId,
      ticketId,
      shopId,
    });
    sendSuccess(res, result, {message: "Ticket accepted"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const deliverDispatch = async (req: Request, res: Response) => {
  try {
    const {ticketId} = req.body;
    const result = await dispatchService.deliverDispatchPush(ticketId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createDispatch, getDispatch, updateDispatchStatus, nearDispatch,
  dispatchOffers, selectDispatch, acceptDispatch, deliverDispatch};
