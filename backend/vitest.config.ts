import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests run against the real MySQL from db/docker-compose.yml. Mocking the driver would
    // defeat the purpose: every guarantee under test is enforced by the database — the
    // PRIMARY KEY race, the lease predicate in the UPDATE's WHERE clause — not by this code.
    env: {
      DB_HOST: "127.0.0.1",
      DB_PORT: "3307",
      DB_USER: "warehouse",
      DB_PASSWORD: "warehouse",
      DB_NAME: "warehouse",
      DB_POOL_SIZE: "20",
      LOG_LEVEL: "silent",
      IDEMPOTENCY_LEASE_MS: "150",
      IDEMPOTENCY_POLL_INTERVAL_MS: "5",
      IDEMPOTENCY_MAX_WAIT_MS: "4000",
    },
    // One database, shared tables: parallel files would race on TRUNCATE.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
