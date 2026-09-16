import {Request, Response} from "express";
import * as ratingService from "../service/ratingService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const submitRating = async (req: Request, res: Response) => {
  try {
    const {uid: byUserId} = req as AuthedRequest;
    const {targetId, targetKind, ticketId, score} = req.body;
    const result = await ratingService.submitRating({
      byUserId,
      targetId,
      targetKind,
      ticketId,
      score,
    });
    sendSuccess(res, result, {message: "Rating submitted"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {submitRating};
