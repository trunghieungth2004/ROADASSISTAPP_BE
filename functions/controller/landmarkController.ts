import {Request, Response} from "express";
import * as landmarkService from "../service/landmarkService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const nearLandmarks = async (req: Request, res: Response) => {
  try {
    const {lat, lng} = req.body;
    const radiusMeters = req.body.radiusMeters ?? 500;
    const result = await landmarkService.nearLandmarks({
      lat,
      lng,
      radiusMeters,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const createLandmark = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {lat, lng, displayLabel} = req.body;
    const result = await landmarkService.createLandmark({
      userId,
      lat,
      lng,
      displayLabel,
    });
    sendSuccess(res, result, {message: "Landmark created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const matchNearby = async (req: Request, res: Response) => {
  try {
    const {lat, lng, embedding, radiusMeters} = req.body;
    const result = await landmarkService.matchNearby({
      lat,
      lng,
      embedding,
      radiusMeters,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {nearLandmarks, createLandmark, matchNearby};
