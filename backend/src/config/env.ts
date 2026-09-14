import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().positive().default(3307),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  DB_POOL_SIZE: z.coerce.number().int().positive().max(200).default(20),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // Measured, not guessed. A sweep at 400 rps put p99 at 386ms with a 4ms poll, 71ms at
  // 15ms and 113ms at 25ms (loadtest/results/measurements.json). Polling faster is worse:
  // hundreds of concurrent waiters each issuing a SELECT every few milliseconds saturate the
  // connection pool and starve the very leaders they are waiting on. Polling slower is also
  // worse, because waiters then sit idle after the leader has already finished.
  IDEMPOTENCY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15),
  IDEMPOTENCY_POLL_JITTER_RATIO: z.coerce.number().min(0).max(1).default(0.4),

  // Must exceed the leader's realistic worst case, not its p99. A cap at 2x p99 would time
  // out healthy requests whenever a leader lands in the tail.
  IDEMPOTENCY_MAX_WAIT_MS: z.coerce.number().int().positive().default(2000),

  // Long enough that a GC pause cannot trigger a false steal, short enough that a genuinely
  // dead leader is taken over well inside the client's wait budget. Steals are safe but not
  // free: the displaced leader's work is rolled back and redone.
  IDEMPOTENCY_LEASE_MS: z.coerce.number().int().positive().default(800),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
