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
      providerId,
      destinationShopId,
      destinationPoint,
      vehicleType,
      vehicleWidth,
      vehicleLabel,
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
      providerId,
      destinationShopId,
      destinationPoint,
      vehicleType,
      vehicleWidth,
      vehicleLabel,
    });
    sendSuccess(res, result, {message: "Dispatch created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getMyTickets = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await dispatchService.getMyTickets(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getDispatch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await dispatchService.getDispatch(ticketId, userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateDispatchStatus = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, status} = req.body;
    const result = await dispatchService.updateDispatchStatus({
      id: ticketId,
      status,
      userId,
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

const updateDispatchDestination = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, destinationShopId, destinationPoint} = req.body;
    const result = await dispatchService.updateDispatchDestination({
      userId,
      ticketId,
      destinationShopId,
      destinationPoint,
    });
    sendSuccess(res, result, {message: "Destination updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const declineDispatch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, shopId, reason, note} = req.body;
    const result = await dispatchService.declineDispatch({
      userId,
      ticketId,
      shopId,
      reason,
      note,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateWorkOrder = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, workType, quotedAmount, finalAmount, invoiceRef} =
      req.body;
    const result = await dispatchService.updateWorkOrder({
      userId,
      ticketId,
      workType,
      quotedAmount,
      finalAmount,
      invoiceRef,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const shopRequests = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {shopId} = req.body;
    const result = await dispatchService.shopRequests({userId, shopId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const shopRecords = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {shopId, limit} = req.body;
    const result = await dispatchService.shopRecords({
      userId,
      shopId,
      limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const feedTickets = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {limit} = req.body;
    const result = await dispatchService.feedTickets({userId, limit});
    sendSuccess(res, result);
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

export {createDispatch, getMyTickets, getDispatch, updateDispatchStatus,
  nearDispatch,
  dispatchOffers, selectDispatch, acceptDispatch, declineDispatch,
  updateWorkOrder, shopRequests, shopRecords, feedTickets,
  updateDispatchDestination,
  deliverDispatch};
