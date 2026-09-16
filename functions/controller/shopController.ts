import {Request, Response} from "express";
import * as shopService from "../service/shopService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const createShop = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {name, lat, lng, type, openHours, hasTow, towVehicleType,
      towVehicleWidth, operatorUid} = req.body;
    const result = await shopService.createShop({
      userId,
      name,
      lat,
      lng,
      type,
      openHours,
      hasTow,
      towVehicleType,
      towVehicleWidth,
      operatorUid,
    });
    sendSuccess(res, result, {message: "Shop created", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateShop = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {shopId, name, openHours, accepting, hasTow, towVehicleType,
      towVehicleWidth, operatorUid} = req.body;
    const result = await shopService.updateShop({
      userId,
      shopId,
      fields: {name, openHours, accepting, hasTow, towVehicleType,
        towVehicleWidth, operatorUid},
    });
    sendSuccess(res, result, {message: "Shop updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const nearShops = async (req: Request, res: Response) => {
  try {
    const {lat, lng, type, radiusMeters, acceptingOnly, openOnly,
      limit} = req.body;
    const result = await shopService.nearShops({
      lat,
      lng,
      type,
      radiusMeters,
      acceptingOnly,
      openOnly,
      limit,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {createShop, updateShop, nearShops};
