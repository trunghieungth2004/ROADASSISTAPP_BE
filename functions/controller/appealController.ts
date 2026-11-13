import {Request, Response} from "express";
import * as appealService from "../service/appealService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const file = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await appealService.fileAppeal({
      userId,
      subjectKind: req.body.subjectKind,
      subjectId: req.body.subjectId,
      reason: req.body.reason,
      note: req.body.note,
      photoUrls: req.body.photoUrls,
    });
    sendSuccess(res, result, {
      message: "Appeal filed",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const eligible = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await appealService.eligibleAppeals(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const adminList = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const result = await appealService.listAppeals({
      adminUid,
      subjectKind: req.body.subjectKind,
      status: req.body.status,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const decide = async (req: Request, res: Response) => {
  try {
    const {uid: adminUid} = req as AuthedRequest;
    const result = await appealService.decideAppeal({
      adminUid,
      appealId: req.body.appealId,
      resolution: req.body.resolution,
      note: req.body.note,
      adjustedAmount: req.body.adjustedAmount,
    });
    sendSuccess(res, result, {message: "Appeal decided"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {file, eligible, adminList, decide};
