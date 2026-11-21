import {Request, Response} from "express";
import * as analyticsService from "../service/analyticsService";
import * as dayDetailService from "../service/dayDetailService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const myAnalytics = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {days, startDate, endDate} = req.body ?? {};
    const result = await analyticsService.myAnalytics({
      userId,
      days,
      startDate,
      endDate,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const myDayDetail = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {date, mode} = req.body ?? {};
    const result = await dayDetailService.myDayDetail({
      userId,
      date,
      mode,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {myAnalytics, myDayDetail};
