import {Request, Response} from "express";
import * as notificationService from "../service/notificationService";
import {AuthedRequest} from "../middleware/auth";
import {sendSuccess, handleServiceError} from "../utils/response";

const getPrefs = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const prefs = await notificationService.getPrefs(uid);
    sendSuccess(res, prefs);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updatePrefs = async (req: Request, res: Response) => {
  try {
    const {uid} = req as AuthedRequest;
    const {paymentUpdates, payoutUpdates} = req.body ?? {};
    const prefs = await notificationService.updatePrefs({
      userId: uid,
      paymentUpdates,
      payoutUpdates,
    });
    sendSuccess(res, prefs, {message: "Notification preferences updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getPrefs, updatePrefs};
