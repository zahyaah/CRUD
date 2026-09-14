import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { cors } from "./http/cors.js";
import { errorHandler, notFoundHandler } from "./http/errorHandler.js";
import { productRoutes } from "./http/routes/products.js";
import { logger } from "./logger.js";
import { snapshot } from "./metrics.js";

export function createApp(): Express {
  const app = express();

  // Ahead of the body parser, so a preflight is answered without reading a body it has none of.
  app.use(cors(env.CORS_ALLOWED_ORIGINS));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));

  app.get("/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });

  app.get("/metrics", (_req, res) => {
    res.json(snapshot());
  });

  app.use("/products", productRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
