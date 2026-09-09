import {Request, Response} from "express";
import * as vehicleProfileService from "../service/vehicleProfileService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const getAllProfiles = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await vehicleProfileService.getProfiles(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const createProfile = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {type, baseWidth, baseHeight} = req.body;
    const result = await vehicleProfileService.createProfile({
      userId,
      type,
      baseWidth,
      baseHeight,
    });
    sendSuccess(res, result, {
      message: "Vehicle profile created",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const addRideConfig = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {profileId, configType, estWidth, estHeight} = req.body;
    const result = await vehicleProfileService.addRideConfig({
      userId,
      profileId,
      configType,
      estWidth,
      estHeight,
    });
    sendSuccess(res, result, {message: "Ride config added", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {getAllProfiles, createProfile, addRideConfig};
