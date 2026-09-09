import {Request, Response} from "express";
import * as routingService from "../service/routingService";
import {sendSuccess, handleServiceError} from "../utils/response";

const getRoute = async (req: Request, res: Response) => {
  try {
    const {userId, originLat, originLng, destLat, destLng, width} = req.body;
    const result = await routingService.getRoute({
      userId,
      originLat,
      originLng,
      destLat,
      destLng,
      width,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getRoute};
