import {Request, Response} from "express";
import * as flagService from "../service/flagService";
import {sendSuccess, handleServiceError} from "../utils/response";

const createFlag = async (req: Request, res: Response) => {
  try {
    const {userId, type, lat, lng, note} = req.body;
    const result = await flagService.createFlag({
      userId,
      type,
      lat,
      lng,
      note,
    });
    sendSuccess(res, result, {message: "Flag submitted", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const confirmFlag = async (req: Request, res: Response) => {
  try {
    const {flagId} = req.body;
    const result = await flagService.confirmFlag(flagId);
    if (!result) {
      sendSuccess(res, null, {message: "Flag not found", statusCode: 404});
      return;
    }
    sendSuccess(res, result, {message: "Flag vote recorded"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getNear = async (req: Request, res: Response) => {
  try {
    const {lat, lng} = req.body;
    const radiusMeters = req.body.radiusMeters ?? 2000;
    const result = await flagService.getNear({lat, lng, radiusMeters});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const moderateFlag = async (req: Request, res: Response) => {
  try {
    const {flagId, status} = req.body;
    const result = await flagService.moderateFlag({flagId, status});
    sendSuccess(res, result, {message: "Flag moderated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const expireFlags = async (_req: Request, res: Response) => {
  try {
    const count = await flagService.expireFlags();
    sendSuccess(
      res,
      {expired: count},
      {message: "Expired flags processed"},
    );
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createFlag, confirmFlag, getNear, moderateFlag, expireFlags};
