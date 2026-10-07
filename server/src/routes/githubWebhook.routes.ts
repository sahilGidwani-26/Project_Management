import { Router } from "express";
import { handleGithubWebhook } from "../controllers/githubWebhook.controller";

const router = Router();
router.post("/:integrationId", handleGithubWebhook);

export default router;