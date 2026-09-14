const counters = {
  leaderRequests: 0,
  waiterRequests: 0,
  lockSteals: 0,
  // Leaders that lost their lease mid-flight and had their work rolled back. Non-zero means
  // leases are expiring faster than the pipeline completes.
  fencedRollbacks: 0,
  waiterTimeouts: 0,
  leaderFailures: 0,
  fingerprintMismatches: 0,
  waiterWaitMsTotal: 0,
};

export type CounterName = keyof typeof counters;

export function increment(name: CounterName, by = 1): void {
  counters[name] += by;
}

export function snapshot(): Record<string, number> {
  const total = counters.leaderRequests + counters.waiterRequests;
  return {
    ...counters,
    // Share of requests that were duplicates coalesced onto an in-flight or completed
    // leader, rather than work the service actually performed.
    dedupRate: total === 0 ? 0 : counters.waiterRequests / total,
    avgWaiterWaitMs:
      counters.waiterRequests === 0 ? 0 : counters.waiterWaitMsTotal / counters.waiterRequests,
  };
}

export function reset(): void {
  for (const key of Object.keys(counters) as CounterName[]) {
    counters[key] = 0;
  }
}
