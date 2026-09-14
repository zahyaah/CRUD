import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

// k6 runs its own JS runtime (goja), not Node, so load-test scripts stay plain JS and are
// excluded from the TypeScript build.

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const DUPLICATES = Number(__ENV.DUPLICATES || 4);
const RATE = Number(__ENV.RATE || 400);
const DURATION = __ENV.DURATION || "60s";
const RUN = __ENV.RUN_ID || String(Date.now());

const created = new Counter("idem_created");
const coalesced = new Counter("idem_coalesced");
const unexpected = new Counter("idem_unexpected");

// Coalescing removed 409 from the contract: every caller, leader or waiter, now gets an
// ordinary success. Anything else is a genuine failure.
http.setResponseCallback(http.expectedStatuses(200, 201));

export const options = {
  summaryTrendStats: ["min", "med", "avg", "p(95)", "p(99)", "max"],
  scenarios: {
    duplicate_bursts: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    // A duplicate that slips through is a correctness failure, so abort the run rather than
    // finish it and report a pretty latency number. abortOnFail is what actually stops it;
    // a bare threshold only marks the run failed at the end.
    idem_unexpected: [{ threshold: "count==0", abortOnFail: true }],
    http_req_failed: [{ threshold: "rate==0", abortOnFail: false }],
  },
};

export function setup() {
  return { runId: RUN };
}

export default function (data) {
  // Consecutive iterations share a key, so each group of DUPLICATES requests is a burst of
  // concurrent retries of the same logical create: a double-clicked submit button.
  const group = Math.floor(exec.scenario.iterationInTest / DUPLICATES);
  const key = `k6-${data.runId}-${group}`;

  const payload = JSON.stringify({
    // The run id is part of the name so that `COUNT(*) - COUNT(DISTINCT name)` stays a valid
    // duplicate check across runs without truncating the table first.
    name: `Load Widget ${data.runId}-${group}`,
    description: "Created by the k6 duplicate-burst scenario",
    price: 19.99,
    category: "loadtest",
    stockQuantity: 10,
    manufacturer: "Acme",
    releaseDate: "2024-01-15",
    rating: 4.5,
  });

  const res = http.post(`${BASE}/products`, payload, {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    tags: { name: "POST /products" },
  });

  if (res.status === 201 && res.headers["Idempotent-Coalesced"] === "false") {
    created.add(1);
  } else if (res.status === 201 && res.headers["Idempotent-Coalesced"] === "true") {
    coalesced.add(1);
  } else {
    unexpected.add(1);
  }
}

export function handleSummary(summary) {
  const m = summary.metrics;
  const value = (name, field) => (m[name] && m[name].values[field]) || 0;

  const result = {
    runId: RUN,
    config: { rate: RATE, duration: DURATION, duplicatesPerKey: DUPLICATES },
    throughputRps: value("http_reqs", "rate"),
    totalRequests: value("http_reqs", "count"),
    latencyMs: {
      p50: value("http_req_duration", "med"),
      p95: value("http_req_duration", "p(95)"),
      p99: value("http_req_duration", "p(99)"),
      max: value("http_req_duration", "max"),
    },
    outcomes: {
      created: value("idem_created", "count"),
      coalesced: value("idem_coalesced", "count"),
      unexpected: value("idem_unexpected", "count"),
    },
    httpFailureRate: value("http_req_failed", "rate"),
  };

  // Not a finding: DUPLICATES fixes this ratio by construction (4 duplicates per key means
  // 75% of requests are duplicates). It is here to confirm the workload was generated as
  // intended, not to describe how well the service deduplicates.
  const total = result.outcomes.created + result.outcomes.coalesced;
  result.injectedDuplicateRatio = total > 0 ? result.outcomes.coalesced / total : 0;
  result.expectedUniqueKeys = Math.ceil(result.totalRequests / DUPLICATES);
  result.note =
    "Row counts are not measured here: k6 cannot query MySQL. Verify with " +
    "SELECT COUNT(*), COUNT(DISTINCT name) FROM product after the run.";

  return {
    stdout: `\n${JSON.stringify(result, null, 2)}\n`,
    [`loadtest/results/idempotency-${RUN}.json`]: JSON.stringify(result, null, 2),
  };
}
