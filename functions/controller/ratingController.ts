import {Request, Response} from "express";
import * as ratingService from "../service/ratingService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const submitRating = async (req: Request, res: Response) => {
  try {
    const {uid: byUserId} = req as AuthedRequest;
    const {targetId, targetKind, ticketId, score, text} = req.body;
    const result = await ratingService.submitRating({
      byUserId,
      targetId,
      targetKind,
      ticketId,
      score,
      text,
    });
    sendSuccess(res, result, {message: "Rating submitted"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const replyRating = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ratingId, reply} = req.body;
    const result = await ratingService.replyToRating({
      userId,
      ratingId,
      reply,
    });
    sendSuccess(res, result, {message: "Reply posted"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const ratingsByTicket = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {ticketId} = req.body;
    const result = await ratingService.ratingsByTicket({userId, ticketId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {submitRating, replyRating, ratingsByTicket};
