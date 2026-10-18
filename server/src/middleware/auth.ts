import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError";
import { catchAsync } from "../utils/catchAsync";
import { verifyToken } from "../utils/token";
import { User } from "../models/User";
import { env } from "../config/env";

// Everything a user may still do while they must replace a temporary password.
const ALLOWED_WHILE_PASSWORD_PENDING = ["/api/auth/me", "/api/auth/change-password", "/api/auth/logout"];

export const requireAuth = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : undefined;
  const token = req.cookies?.[env.JWT_COOKIE_NAME] || bearer;

  if (!token) throw ApiError.unauthorized("Authentication required");

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired session");
  }

  const user = await User.findById(payload.userId).select("_id email accountStatus mustChangePassword");
  if (!user) throw ApiError.unauthorized("User no longer exists");
  if (user.accountStatus === "suspended") throw ApiError.forbidden("Account suspended");

  if (user.mustChangePassword) {
    const path = req.originalUrl.split("?")[0].replace(/\/+$/, "");
    if (!ALLOWED_WHILE_PASSWORD_PENDING.includes(path)) {
      return res.status(403).json({
        success: false,
        code: "PASSWORD_CHANGE_REQUIRED",
        message: "Please choose a new password before continuing",
      });
    }
  }

  req.user = { id: user._id.toString(), email: user.email };
  next();
});

export const requireSuperAdmin = catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
  const user = await User.findById(req.user?.id).select("isSuperAdmin");
  if (!user?.isSuperAdmin) throw ApiError.forbidden("Super admin access required");
  next();
});