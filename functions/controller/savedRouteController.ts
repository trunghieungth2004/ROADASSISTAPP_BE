import {Request, Response} from "express";
import * as savedRouteService from "../service/savedRouteService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const saveRoute = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {
      name,
      originLat,
      originLng,
      destLat,
      destLng,
      stops,
      width,
      distanceMeters,
      durationSeconds,
      source,
      geometry,
      via,
      hazards,
    } = req.body;
    const result = await savedRouteService.saveRoute({
      userId,
      name,
      originLat,
      originLng,
      destLat,
      destLng,
      stops,
      width,
      distanceMeters,
      durationSeconds,
      source,
      geometry,
      via,
      hazards,
    });
    sendSuccess(res, result, {message: "Route saved", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const listRoutes = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await savedRouteService.listRoutes(userId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const getRoute = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {routeId} = req.body;
    const result = await savedRouteService.getRoute({routeId, userId});
    if (!result) {
      sendSuccess(res, null, {message: "Route not found", statusCode: 404});
      return;
    }
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const renameRoute = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {routeId, name} = req.body;
    const result = await savedRouteService.renameRoute({
      routeId,
      userId,
      name,
    });
    if (!result) {
      sendSuccess(res, null, {message: "Route not found", statusCode: 404});
      return;
    }
    sendSuccess(res, result, {message: "Route renamed"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const deleteRoute = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {routeId} = req.body;
    const result = await savedRouteService.deleteRoute({routeId, userId});
    if (!result) {
      sendSuccess(res, null, {message: "Route not found", statusCode: 404});
      return;
    }
    sendSuccess(res, result, {message: "Route deleted"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {saveRoute, listRoutes, getRoute, renameRoute, deleteRoute};
