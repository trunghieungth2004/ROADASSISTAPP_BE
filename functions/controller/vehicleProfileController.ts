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
    const {type, baseWidth, baseHeight, label, plate} = req.body;
    const result = await vehicleProfileService.createProfile({
      userId,
      type,
      baseWidth,
      baseHeight,
      ...(typeof label === "string" ? {label} : {}),
      ...(typeof plate === "string" ? {plate} : {}),
    });
    sendSuccess(res, result, {
      message: "Vehicle profile created",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateProfile = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {profileId, label, plate, baseWidth, baseHeight} = req.body;
    const result = await vehicleProfileService.updateProfile({
      userId,
      profileId,
      ...(typeof label === "string" ? {label} : {}),
      ...(typeof plate === "string" ? {plate} : {}),
      ...(typeof baseWidth === "number" ? {baseWidth} : {}),
      ...(typeof baseHeight === "number" ? {baseHeight} : {}),
    });
    sendSuccess(res, result, {message: "Vehicle updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const history = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {profileId, limit} = req.body;
    const result = await vehicleProfileService.vehicleHistory({
      userId,
      profileId,
      ...(typeof limit === "number" ? {limit} : {}),
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const removeProfile = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {profileId} = req.body;
    const result = await vehicleProfileService.removeProfile({
      userId,
      profileId,
    });
    sendSuccess(res, result, {message: "Vehicle removed"});
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


export {
  getAllProfiles,
  createProfile,
  updateProfile,
  history,
  removeProfile,
  addRideConfig,
};
