import {Request, Response} from "express";
import * as shopService from "../service/shopService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const createShop = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {name, lat, lng, type} = req.body;
    const result = await shopService.createShop({
      userId,
      name,
      lat,
      lng,
      type,
    });
    sendSuccess(res, result, {message: "Shop created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const nearShops = async (req: Request, res: Response) => {
  try {
    const {lat, lng, type, radiusMeters} = req.body;
    const result = await shopService.nearShops({
      lat,
      lng,
      type,
      radiusMeters,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createShop, nearShops};
