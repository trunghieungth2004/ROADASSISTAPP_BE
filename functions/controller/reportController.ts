import {Request, Response} from "express";
import * as reportService from "../service/behaviorReportService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const file = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.fileReport({
      reportedBy: userId,
      targetKind: req.body.targetKind,
      targetId: req.body.targetId,
      ticketId: req.body.ticketId,
      reason: req.body.reason,
      note: req.body.note,
      photoUrls: req.body.photoUrls,
    });
    sendSuccess(res, result, {
      message: "Report filed",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const mine = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.myReports(userId);
    sendSuccess(res, {reports: result});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const adminList = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.listReports({
      adminUid: userId,
      targetKind: req.body.targetKind,
      status: req.body.status,
    });
    sendSuccess(res, {reports: result});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const decide = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.decideReport({
      adminUid: userId,
      reportId: req.body.reportId,
      action: req.body.action,
      note: req.body.note,
    });
    sendSuccess(res, result, {message: "Report decided"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const clearRestriction = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.clearReportRestriction({
      adminUid: userId,
      targetKind: req.body.targetKind,
      targetId: req.body.targetId,
    });
    sendSuccess(res, result, {message: "Restriction cleared"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const standing = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.userStanding({
      adminUid: userId,
      userId: req.body.userId,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const resetStanding = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await reportService.resetUserStanding({
      adminUid: userId,
      userId: req.body.userId,
    });
    sendSuccess(res, result, {message: "Standing reset"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  file,
  mine,
  adminList,
  decide,
  clearRestriction,
  standing,
  resetStanding,
};
