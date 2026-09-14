import mysql from "mysql2/promise";
import type { Pool, PoolConnection } from "mysql2/promise";
import { env } from "../config/env.js";

/** Anything a query can run against, so repositories work on the pool or inside a transaction. */
export type Queryable = Pool | PoolConnection;

export const pool: Pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_SIZE,
  waitForConnections: true,
  // Queue without bound: under a burst, callers wait for a connection rather than being
  // rejected. Backpressure belongs at the HTTP edge, not silently in the driver.
  queueLimit: 0,
  // DATE columns arrive as 'YYYY-MM-DD' strings instead of JS Dates, which would otherwise
  // be re-serialised in the server's local timezone and shift the date by a day.
  dateStrings: true,
});

export function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ER_DUP_ENTRY"
  );
}
