import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { deletePhoto, getProfile, resendVerification, updateProfile, uploadPhoto } from "../controllers/profile.controller";

const router = Router();
router.use(requireAuth);

router.get("/", getProfile);
router.put("/", updateProfile);
router.put("/photo", uploadPhoto);
router.delete("/photo", deletePhoto);
router.post("/resend-verification", resendVerification);

export default router;