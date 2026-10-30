import {resolveShopOperator} from "./helpers";
import * as dispatchRepository from "../../../repository/dispatchRepository";


export const getShopRequests = async ({
  userId,
  shopId,
}: {
  userId: string;
  shopId: string;
}) => {
  await resolveShopOperator(userId, shopId);
  return dispatchRepository.findPendingForShop(shopId);
};


export const getShopRecords = async ({
  userId,
  shopId,
  limit = 20,
}: {
  userId: string;
  shopId: string;
  limit?: number;
}) => {
  await resolveShopOperator(userId, shopId);
  return dispatchRepository.findRecentForShop(shopId, limit);
};
