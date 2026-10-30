import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import * as chatController from "../controller/chatController";

export default (
  app: Express,
  {requireAuth, validate, schemas}: RouteDeps,
) => {
  app.post(
    "/chat/open",
    requireAuth,
    validate({body: schemas.chatRoom}),
    chatController.openRoom,
  );
  app.post(
    "/chat/messages",
    requireAuth,
    validate({body: schemas.chatRoom}),
    chatController.listMessages,
  );
  app.post(
    "/chat/send",
    writeLimited,
    requireAuth,
    validate({body: schemas.chatSend}),
    chatController.sendMessage,
  );
};
