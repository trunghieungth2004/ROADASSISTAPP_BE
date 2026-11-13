import {Express} from "express";
import {RouteDeps} from "../types/routes";
import {writeLimited} from "../middleware/rateLimit";
import {ROLE_ADMIN} from "../constants/roles";
import * as chatController from "../controller/chatController";

export default (
  app: Express,
  {requireAuth, requireRole, validate, schemas}: RouteDeps,
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
  app.post(
    "/admin/chat/messages",
    requireAuth,
    requireRole(ROLE_ADMIN),
    validate({body: schemas.adminChatMessages}),
    chatController.adminMessages,
  );
};
