import {Request, Response} from "express";
import {chatService} from "../service/chatService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const openRoom = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {scope, refId} = req.body;
    const result = await chatService.open({userId, scope, refId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listMessages = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {scope, refId} = req.body;
    const result = await chatService.messages({userId, scope, refId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const sendMessage = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {scope, refId, text, photoUrls} = req.body;
    const result = await chatService.send({
      userId,
      scope,
      refId,
      text,
      photoUrls,
    });
    sendSuccess(res, result, {message: "Message sent", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {openRoom, listMessages, sendMessage};
