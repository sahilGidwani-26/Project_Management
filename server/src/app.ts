import express, { Application } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import routes from "./routes";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { env } from "./config/env";
import { mailContextMiddleware } from "./utils/mailContext";

export function createApp(): Application {
  const app = express();
  // Behind a proxy (Render, Nginx, ...) the real visitor address is in X-Forwarded-For. Needed for the join rate limits.
  if (env.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    })
  );

  app.use(
    express.json({
      limit: "5mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = Buffer.from(buf);
      },
    })
  );

  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
    app.use(mailContextMiddleware);

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/api", apiLimiter);

  app.get("/", (_req, res) =>
    res.json({
      success: true,
      message: "Project Management SaaS API",
    })
  );

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}