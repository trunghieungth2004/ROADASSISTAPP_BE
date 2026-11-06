import {Request, Response} from "express";
import * as bookingService from "../service/bookingService";
import {sendSuccess, handleServiceError} from "../utils/response";
import {AuthedRequest} from "../middleware/auth";

const availability = async (req: Request, res: Response) => {
  try {
    const result = await bookingService.getAvailability(req.body);
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const create = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.createBooking({...req.body, userId});
    sendSuccess(res, result, {message: "Booking requested", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const updatePlan = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.updateBookingPlan({
      ...req.body,
      userId,
    });
    sendSuccess(res, result, {message: "Booking updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const respond = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.respondBooking({...req.body, userId});
    sendSuccess(res, result, {message: "Booking updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const cancel = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.cancelBooking({...req.body, userId});
    sendSuccess(res, result, {message: "Booking cancelled"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const arrive = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.arriveBooking({...req.body, userId});
    sendSuccess(res, result, {message: "Checked in"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const deposit = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.collectDeposit({
      userId,
      bookingId: req.body.bookingId,
      collected: req.body.collected !== false,
    });
    sendSuccess(res, result, {message: "Deposit updated"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const createTow = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.createBookingTow({
      userId,
      bookingId: req.body.bookingId,
    });
    sendSuccess(res, result, {message: "Tow requested", statusCode: 201});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const depositCheckout = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.getDepositCheckout({
      userId,
      bookingId: req.body.bookingId,
    });
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const requestDeposit = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.requestDeposit({
      userId,
      bookingId: req.body.bookingId,
    });
    sendSuccess(res, result, {message: "Deposit requested"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const complete = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.completeBooking({...req.body, userId});
    sendSuccess(res, result, {message: "Booking completed"});
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const mine = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.myBookings({userId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const shop = async (req: Request, res: Response) => {
  try {
    const {uid: userId} = req as AuthedRequest;
    const result = await bookingService.shopBookings({...req.body, userId});
    sendSuccess(res, result);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

const config = async (_req: Request, res: Response) => {
  try {
    sendSuccess(res, bookingService.bookingConfigDefaults);
  } catch (error) {
    handleServiceError(res, error as Error);
  }
};

export {
  availability,
  create,
  updatePlan,
  respond,
  cancel,
  arrive,
  complete,
  deposit,
  requestDeposit,
  depositCheckout,
  createTow,
  mine,
  shop,
  config,
};
