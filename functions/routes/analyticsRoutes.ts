import {Express} from "express";
import {RouteDeps} from "../types/routes";
import * as analyticsController from "../controller/analyticsController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/analytics/me",
    requireAuth,
    validate({body: schemas.myAnalytics}),
    analyticsController.myAnalytics,
  );
  app.post(
    "/analytics/me/day",
    requireAuth,
    validate({body: schemas.myAnalyticsDay}),
    analyticsController.myDayDetail,
  );
};
