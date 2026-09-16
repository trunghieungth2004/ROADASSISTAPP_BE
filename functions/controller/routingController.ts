import {Request, Response} from "express";
import * as routingService from "../service/routingService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const getRoute = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {originLat, originLng, destLat, destLng, stops, width,
      vehicleType} = req.body;
    const result = await routingService.getRoute({
      userId,
      originLat,
      originLng,
      destLat,
      destLng,
      stops,
      width,
      vehicleType,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getRoute};
