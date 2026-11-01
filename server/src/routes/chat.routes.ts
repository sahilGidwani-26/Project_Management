import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loadWorkspaceRole, requirePermission } from "../middleware/workspaceRole";
import { channelGate, messageGate } from "../middleware/resourceAccess";
import { createChannelSchema, sendMessageSchema } from "../validations/chat.validation";
import {
  createChannel,
  listChannels,
  getOrCreateDM,
  joinChannel,
  listMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  addReaction,
} from "../controllers/chat.controller";

const router = Router();
router.use(requireAuth);

// creating a channel sends workspaceId in the body, the other workspace routes have it in the URL
router.post("/channels", validate(createChannelSchema), loadWorkspaceRole, requirePermission("chat.channels"), createChannel);
router.get("/channels/workspace/:workspaceId", loadWorkspaceRole, requirePermission("chat.view"), listChannels);
router.post("/channels/workspace/:workspaceId/dm", loadWorkspaceRole, requirePermission("chat.send"), getOrCreateDM);

// private channels and DMs are only open to their own members (checked in the gates)
router.post("/channels/:channelId/join", channelGate("chat.view"), joinChannel);
router.get("/channels/:channelId/messages", channelGate("chat.view"), listMessages);
router.post("/channels/:channelId/messages", validate(sendMessageSchema), channelGate("chat.send"), sendMessage);
router.patch("/messages/:messageId", messageGate("chat.send"), editMessage);
router.delete("/messages/:messageId", messageGate("chat.send"), deleteMessage);
router.post("/messages/:messageId/reactions", messageGate("chat.send"), addReaction);

export default router;