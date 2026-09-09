import * as dispatchRepository from "../repository/dispatchRepository";
import * as userRepository from "../repository/userRepository";
import {STATUS_DISPATCH} from "../constants/status";

class ValidationError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
class NotFoundError extends Error {
  statusCode: number;
  constructor(message: string) {
    super(message);
    this.statusCode = 404;
  }
}

const VALID_STATUSES: string[] = Object.values(STATUS_DISPATCH);

const createDispatch = async ({
  userId,
  ticketType,
  lat,
  lng,
  diagnosticId,
}: {
  userId: string;
  ticketType: string;
  lat: number;
  lng: number;
  diagnosticId?: string;
}) => {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  return dispatchRepository.create({
    userId,
    ticketType,
    lat,
    lng,
    diagnosticId,
  });
};

const getDispatch = async (id: string) => {
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  return ticket;
};

const updateDispatchStatus = async ({
  id,
  status,
}: {
  id: string;
  status: string;
}) => {
  if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError("Invalid dispatch status");
  }
  const ticket = await dispatchRepository.findById(id);
  if (!ticket) throw new NotFoundError("Dispatch ticket not found");
  await dispatchRepository.updateStatus(id, status);
  return {updated: 1};
};

export {
  createDispatch,
  getDispatch,
  updateDispatchStatus,
  ValidationError,
  NotFoundError,
};
