import {Request, Response} from "express";
import * as pushService from "../service/pushService";
import {QUEUE_NAME} from "../service/taskQueueService";
import {sendError, sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const register = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {token} = req.body as {token: string};
    const record = await pushService.registerPushToken(userId, token);
    sendSuccess(res, record, {statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const unregister = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {token} = req.body as {token: string};
    const result = await pushService.unregisterPushToken(userId, token);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const deliver = async (req: Request, res: Response) => {
  try {
    if (req.header("X-CloudTasks-QueueName") !== QUEUE_NAME) {
      sendError(
        res,
        {statusCode: 403, message: "Forbidden"} as Error & {
          statusCode: number;
        },
      );
      return;
    }
    const {flagId} = req.body as {flagId: string};
    const result = await pushService.deliverHazardPush(flagId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {register, unregister, deliver};
