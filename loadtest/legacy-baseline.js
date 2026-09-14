import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

// Same duplicate-burst workload as idempotency.js, aimed at the pre-revamp server. The
// legacy POST has no Idempotency-Key, so the id in the body is the only thing identifying a
// resubmit, exactly what a double-clicked form produced at `pre-revamp`.

const BASE = __ENV.BASE_URL || "http://localhost:3001";
const DUPLICATES = Number(__ENV.DUPLICATES || 4);
const RATE = Number(__ENV.RATE || 400);
const DURATION = __ENV.DURATION || "60s";

const accepted = new Counter("legacy_201");
const serverError = new Counter("legacy_500");
const other = new Counter("legacy_other");
// Status 0 means k6 never got an HTTP response at all: the connection was refused, reset
// or timed out. Counted apart from 500 because it is a different failure: the client cannot
// know whether the write landed.
const transportFailure = new Counter("legacy_transport_failure");

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
  // No thresholds: this run is expected to fail correctness. Recording how it fails is the
  // entire point of the baseline.
};

export default function () {
  const group = Math.floor(exec.scenario.iterationInTest / DUPLICATES);

  const payload = JSON.stringify({
    id: group + 1,
    name: `Load Widget ${group}`,
    description: "Created by the k6 duplicate-burst scenario",
    price: 19.99,
    category: "loadtest",
    stock_quantity: 10,
    manufacturer: "Acme",
    release_date: "2024-01-15",
    rating: 4.5,
  });

  const res = http.post(`${BASE}/products`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { name: "POST /products (legacy)" },
  });

  if (res.status === 201) accepted.add(1);
  else if (res.status === 500) serverError.add(1);
  else if (res.status === 0) transportFailure.add(1);
  else other.add(1);
}

export function handleSummary(summary) {
  const m = summary.metrics;
  const value = (name, field) => (m[name] && m[name].values[field]) || 0;

  const result = {
    target: "pre-revamp server (express 4.19, single connection, no idempotency)",
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
      accepted201: value("legacy_201", "count"),
      // Every duplicate submit lands here: the insert violated the primary key and
      // server.js:80-81 collapsed it into an opaque 500, indistinguishable from a real
      // outage even though the user's product had in fact been created.
      serverError500: value("legacy_500", "count"),
      transportFailure: value("legacy_transport_failure", "count"),
      other: value("legacy_other", "count"),
    },
    expectedUniqueProducts: Math.ceil(value("http_reqs", "count") / DUPLICATES),
  };

  return {
    stdout: `\n${JSON.stringify(result, null, 2)}\n`,
    "loadtest/results/legacy-baseline.json": JSON.stringify(result, null, 2),
  };
}
