import {Request, Response} from "express";
import * as dispatchService from "../service/dispatchService";
import {DISPATCH_QUEUE_NAME} from "../service/taskQueueService";
import {sendError, sendSuccess, handleServiceError} from "../utils/response";
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
      description,
      photoUrls,
      providerId,
      destinationShopId,
      destinationPoint,
      vehicleType,
      vehicleWidth,
      vehicleLabel,
      force,
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
      description,
      photoUrls,
      providerId,
      destinationShopId,
      destinationPoint,
      vehicleType,
      vehicleWidth,
      vehicleLabel,
      force: force === true,
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
    const {ticketId, status, lat, lng, reasonCode} = req.body;
    const result = await dispatchService.updateDispatchStatus({
      id: ticketId,
      status,
      userId,
      ...(typeof lat === "number" ? {lat} : {}),
      ...(typeof lng === "number" ? {lng} : {}),
      ...(typeof reasonCode === "string" && reasonCode !== "" ?
        {reasonCode} :
        {}),
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
    const {lat, lng, radiusMeters, kind, limit, accessWidthMeters,
      ticketId, minRating, sortBy} = req.body;
    const result = await dispatchService.dispatchOffers({
      lat,
      lng,
      radiusMeters,
      kind,
      limit,
      accessWidthMeters,
      ticketId,
      minRating,
      sortBy,
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

const sendQuote = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, quotedAmount, finalAmount, workType, faultPhotos} =
      req.body;
    const result = await dispatchService.sendQuote({
      userId,
      ticketId,
      quotedAmount,
      finalAmount,
      workType,
      faultPhotos,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const sendEstimate = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, estimateAmount, estimateNote, eta} = req.body;
    const result = await dispatchService.sendEstimate({
      userId,
      ticketId,
      estimateAmount,
      estimateNote,
      eta,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const approveEstimate = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await dispatchService.approveEstimate({userId, ticketId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const declineEstimate = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, shopId} = req.body;
    const result = await dispatchService.declineEstimate({
      userId,
      ticketId,
      shopId,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const markUnfixable = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, reason, photoUrls} = req.body;
    const result = await dispatchService.markUnfixable({
      userId,
      ticketId,
      reason,
      photoUrls,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const approveQuote = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await dispatchService.approveQuote({userId, ticketId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const declineDestination = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, reasonCode} = req.body;
    const result = await dispatchService.declineDestination({
      userId,
      ticketId,
      reasonCode,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const cancelTowerSearch = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, lat, lng, reasonCode, note} = req.body;
    const result = await dispatchService.cancelTowerSearch({
      userId,
      ticketId,
      ...(typeof lat === "number" ? {lat} : {}),
      ...(typeof lng === "number" ? {lng} : {}),
      reasonCode,
      ...(typeof note === "string" && note !== "" ? {note} : {}),
    });
    sendSuccess(res, result, {message: "Tower search restarted"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const waitingStatus = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await dispatchService.waitingSummary({userId, ticketId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const refreshTowEta = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await dispatchService.refreshTowEta({userId, ticketId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const estimateTowFare = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId, lat, lng} = req.body;
    const result = await dispatchService.estimateTowFarePreview({
      userId,
      ticketId,
      lat,
      lng,
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
    if (req.header("X-CloudTasks-QueueName") !== DISPATCH_QUEUE_NAME) {
      sendError(
        res,
        {statusCode: 403, message: "Forbidden"} as Error & {
          statusCode: number;
        },
      );
      return;
    }
    const {ticketId, audience, title, body, shopId, urgent} = req.body;
    const result = await dispatchService.deliverDispatchPush(
      ticketId,
      audience,
      typeof title === "string" && typeof body === "string" ?
        {title, body} :
        undefined,
      typeof shopId === "string" && shopId !== "" ? shopId : undefined,
      urgent === true || urgent === "true",
    );
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createDispatch, getMyTickets, getDispatch, updateDispatchStatus,
  nearDispatch,
  dispatchOffers, selectDispatch, acceptDispatch, declineDispatch,
  sendQuote, sendEstimate, approveEstimate, declineEstimate, markUnfixable,
  approveQuote, declineDestination, cancelTowerSearch, waitingStatus,
  refreshTowEta, estimateTowFare,
  updateWorkOrder, shopRequests, shopRecords, feedTickets,
  updateDispatchDestination,
  deliverDispatch};
