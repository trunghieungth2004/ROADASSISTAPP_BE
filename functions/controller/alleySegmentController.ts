import {Request, Response} from "express";
import * as alleySegmentService from "../service/alleySegmentService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const getSegment = async (req: Request, res: Response) => {
  try {
    const {segmentId} = req.body;
    const result = await alleySegmentService.getSegment(segmentId);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const searchNear = async (req: Request, res: Response) => {
  try {
    const {lat, lng} = req.body;
    const radiusMeters = req.body.radiusMeters ?? 2000;
    const result = await alleySegmentService.searchNear({
      lat,
      lng,
      radiusMeters,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const createSegment = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {lat, lng, baseWidth, wireHeight, inclinePct, tier} = req.body;
    const result = await alleySegmentService.createSegment({
      userId,
      lat,
      lng,
      baseWidth,
      wireHeight,
      inclinePct,
      tier,
    });
    sendSuccess(res, result, {
      message: "Alley segment created",
      statusCode: 201,
    });
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const setPassability = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const {segmentId, baseWidth, wireHeight, inclinePct, tier} = req.body;
    const result = await alleySegmentService.setPassability({
      userId,
      segmentId,
      baseWidth,
      wireHeight,
      inclinePct,
      tier,
    });
    sendSuccess(res, result, {message: "Passability updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const moderateSegment = async (req: Request, res: Response) => {
  try {
    const {
      segmentId,
      baseWidth,
      wireHeight,
      inclinePct,
      tier,
      verifiedCount,
    } = req.body;
    const result = await alleySegmentService.moderateSegment({
      segmentId,
      baseWidth,
      wireHeight,
      inclinePct,
      tier,
      verifiedCount,
    });
    sendSuccess(res, result, {message: "Segment moderated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  getSegment,
  searchNear,
  createSegment,
  setPassability,
  moderateSegment,
};
