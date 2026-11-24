import { Router } from "express";
import { serveMedia } from "../controllers/profile.controller";

const router = Router();
router.get("/:kind/:id", serveMedia); // public on purpose, see the controller

export default router;