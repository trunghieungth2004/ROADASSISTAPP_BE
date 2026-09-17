import {Request, Response} from "express";
import * as userService from "../service/userService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const register = async (req: Request, res: Response) => {
  try {
    const {email, password, displayName, phone} = req.body;
    const result = await userService.register(
      {email, password, displayName, phone});
    sendSuccess(res, result, {
      message: "User registered successfully",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getOneUser = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await userService.getOneUser(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getAllUser = async (_req: Request, res: Response) => {
  try {
    const result = await userService.getAllUser();
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateRole = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {targetUserId, role} = req.body;
    const result = await userService.updateRole({
      actorId: userId,
      targetUserId,
      role,
    });
    sendSuccess(res, result, {message: "User role updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateTrustScore = async (req: Request, res: Response) => {
  try {
    const {targetUserId, trustScore} = req.body;
    const result = await userService.updateTrustScore({
      targetUserId,
      trustScore,
    });
    sendSuccess(res, result, {message: "Trust score updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateStatus = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {targetUserId, status} = req.body;
    const result = await userService.updateStatus({
      actorId: userId,
      targetUserId,
      status,
    });
    sendSuccess(res, result, {message: "User status updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateProfile = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {displayName} = req.body;
    const result = await userService.updateProfile({userId, displayName});
    sendSuccess(res, result, {message: "Profile updated successfully"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const setVolunteerAvailability = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {available, volunteerRadiusKm, capability} = req.body;
    const result = await userService.setVolunteerAvailability({
      userId,
      available,
      volunteerRadiusKm,
      capability,
    });
    sendSuccess(res, result, {message: "Volunteer status updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const volunteerHeartbeat = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {lat, lng} = req.body;
    const result = await userService.volunteerHeartbeat({
      userId,
      lat,
      lng,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const sweepVolunteers = async (_req: Request, res: Response) => {
  try {
    const count = await userService.sweepStaleVolunteers();
    sendSuccess(
      res,
      {swept: count},
      {message: "Stale volunteer locations removed"},
    );
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getMe = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await userService.me(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const setActiveVehicle = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {profileId} = req.body;
    const result = await userService.setActiveVehicle({userId, profileId});
    sendSuccess(res, result, {message: "Active vehicle updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const setOnboarded = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {service, role} = req.body;
    const result = await userService.setOnboarded({userId, service, role});
    sendSuccess(res, result, {message: "Onboarding updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updateServices = async (req: Request, res: Response) => {
  try {
    const {targetUserId, grant, revoke} = req.body;
    const result = await userService.updateServices(
      {targetUserId, grant, revoke});
    sendSuccess(res, result, {message: "Service licenses updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  register,
  getOneUser,
  getAllUser,
  setActiveVehicle,
  setOnboarded,
  updateServices,
  getMe,
  updateRole,
  updateTrustScore,
  updateStatus,
  updateProfile,
  setVolunteerAvailability,
  volunteerHeartbeat,
  sweepVolunteers,
};
