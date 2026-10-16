import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getConnectUrl,
  googleCalendarCallback,
  disconnectGoogleCalendarHandler,
  getGoogleCalendarStatus,
} from "../controllers/googleCalendar.controller";

const router = Router();

router.get("/status", requireAuth, getGoogleCalendarStatus);
router.get("/connect-url", requireAuth, getConnectUrl);
router.post("/disconnect", requireAuth, disconnectGoogleCalendarHandler);

// Google redirects the browser here, so there's no Authorization header: auth comes from the signed `state`.
router.get("/callback", googleCalendarCallback);

export default router;