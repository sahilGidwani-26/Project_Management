import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { upload } from "../middleware/upload";
import { attachmentGate } from "../middleware/resourceAccess";
import { uploadAttachment, listAttachments, deleteAttachment } from "../controllers/attachment.controller";

const router = Router();
router.use(requireAuth);

// the form fields (taskId) are only readable after multer, so the gate runs after it (and deletes the file again if refused)
router.post("/", upload.single("file"), attachmentGate("tasks.comment", "body"), uploadAttachment);
router.get("/", attachmentGate("tasks.view", "query"), listAttachments);
router.delete("/:id", attachmentGate("tasks.comment", "doc"), deleteAttachment);

export default router;