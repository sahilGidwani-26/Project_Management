import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { loadWorkspaceRole, requireWorkspaceRole } from "../middleware/workspaceRole";
import { NOT_VIEWER } from "../middleware/taskAccess";
import { createEventSchema, updateEventSchema, notesSchema } from "../validations/event.validation";
import {
  createEvent,
  listEvents,
  listDeadlines,
  getEvent,
  updateEvent,
  deleteEvent,
  updateNotes,
} from "../controllers/event.controller";

const router = Router();
router.use(requireAuth);

// Viewers can see the calendar but can't create events.
router.post("/", validate(createEventSchema), loadWorkspaceRole, requireWorkspaceRole(...NOT_VIEWER), createEvent);
router.get("/workspace/:workspaceId", loadWorkspaceRole, listEvents);
router.get("/workspace/:workspaceId/deadlines", loadWorkspaceRole, listDeadlines);

// These resolve the workspace from the event itself and check membership inside the controller.
router.get("/:eventId", getEvent);
router.patch("/:eventId", validate(updateEventSchema), updateEvent);
router.delete("/:eventId", deleteEvent);
router.patch("/:eventId/notes", validate(notesSchema), updateNotes);

export default router;