import {Request, Response} from "express";
import * as savedPlaceService from "../service/savedPlaceService";
import {AuthedRequest} from "../middleware/auth";
import {sendSuccess, handleServiceError} from "../utils/response";

const savePlace = async (req: Request, res: Response) => {
  try {
    const {uid} = req as unknown as AuthedRequest;
    const {label, lat, lng} = req.body;
    const result = await savedPlaceService.savePlace({
      userId: uid,
      label,
      lat,
      lng,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listSavedPlaces = async (req: Request, res: Response) => {
  try {
    const {uid} = req as unknown as AuthedRequest;
    const result = await savedPlaceService.listSavedPlaces(uid);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const removeSavedPlace = async (req: Request, res: Response) => {
  try {
    const {uid} = req as unknown as AuthedRequest;
    const {placeId} = req.body;
    const result = await savedPlaceService.removeSavedPlace({
      userId: uid,
      placeId,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {savePlace, listSavedPlaces, removeSavedPlace};
