import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import { pool } from "./db/pool.js";
import { errorHandler, notFoundHandler } from "./http/errorHandler.js";
import { productRoutes } from "./http/routes/products.js";
import { logger } from "./logger.js";
import { snapshot } from "./metrics.js";

export function createApp(): Express {
  const app = express();

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
