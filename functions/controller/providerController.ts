import {Request, Response} from "express";
import * as providerService from "../service/providerService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const createProvider = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {kind, name, lat, lng, label, openHours, plate, vehicleType,
      vehicleWidth} = req.body;
    const result = kind === "TOW" ?
      await providerService.createTowProvider({
        userId,
        name,
        lat,
        lng,
        label,
        plate,
        vehicleType,
        vehicleWidth,
      }) :
      await providerService.createShopProvider({
        userId,
        name,
        lat,
        lng,
        label,
        openHours,
      });
    sendSuccess(res, result, {message: "Provider created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateProvider = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {providerId, name, label, openHours, accepting, lat, lng} =
      req.body;
    const result = await providerService.updateProvider({
      userId,
      providerId,
      fields: {name, label, openHours, accepting, lat, lng},
    });
    sendSuccess(res, result, {message: "Provider updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const myProviders = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await providerService.myProviders({userId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const nearProviders = async (req: Request, res: Response) => {
  try {
    const {lat, lng, kind, radiusMeters, acceptingOnly, openOnly,
      limit} = req.body;
    const result = await providerService.nearProviders({
      lat,
      lng,
      kind,
      radiusMeters,
      acceptingOnly,
      openOnly,
      limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listPending = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const result = await providerService.listPending(adminUid);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const reviewProvider = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const {providerId, approve, reviewNote} = req.body;
    const result = await providerService.reviewProvider({
      adminUid,
      providerId,
      approve,
      reviewNote,
    });
    sendSuccess(res, result, {message: "Provider reviewed"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const reportProvider = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {providerId, reason, note, ticketId} = req.body;
    const result = await providerService.reportProvider({
      userId,
      providerId,
      reason,
      note,
      ticketId: typeof ticketId === "string" && ticketId !== "" ?
        ticketId :
        undefined,
    });
    sendSuccess(res, result, {message: "Report filed", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listReports = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const result = await providerService.listReports(adminUid);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const dismissReport = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const {reportId} = req.body;
    const result = await providerService.dismissReport({
      adminUid,
      reportId,
    });
    sendSuccess(res, result, {message: "Report dismissed"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const suspendProvider = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const {providerId, reason, reportId} = req.body;
    const result = await providerService.suspendProvider({
      adminUid,
      providerId,
      reason,
      reportId: typeof reportId === "string" && reportId !== "" ?
        reportId :
        undefined,
    });
    sendSuccess(res, result, {message: "Provider suspended"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const restoreProvider = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const {providerId} = req.body;
    const result = await providerService.restoreProvider({
      adminUid,
      providerId,
    });
    sendSuccess(res, result, {message: "Provider restored"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateProviderLocation = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {lat, lng} = req.body;
    const result = await providerService.updateProviderLocation({
      userId,
      lat,
      lng,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createProvider, updateProvider, myProviders, nearProviders,
  listPending, reviewProvider, reportProvider, listReports, dismissReport,
  suspendProvider, restoreProvider, updateProviderLocation};
