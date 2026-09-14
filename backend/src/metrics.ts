const counters = {
  /** One per POST that reaches the idempotency service, whatever role it ends up playing. */
  requests: 0,
  /** Leaders whose transaction committed, so this is also the count of operations executed. */
  leaderExecutions: 0,
  /** Requests answered from a leader's stored response instead of doing the work. */
  coalescedResponses: 0,
  lockSteals: 0,
  /**
   * Leaders that lost their lease mid-flight and had their work rolled back. A non-zero value
   * means leases are expiring faster than the pipeline completes, and the work is being redone.
   */
  fencedRollbacks: 0,
  waiterTimeouts: 0,
  leaderFailures: 0,
  fingerprintMismatches: 0,
  waiterWaitMsTotal: 0,
  waiterCount: 0,
};

export type CounterName = keyof typeof counters;

export function increment(name: CounterName, by = 1): void {
  counters[name] += by;
}

export function snapshot(): Record<string, number> {
  return {
    ...counters,
    dedupRate: counters.requests === 0 ? 0 : counters.coalescedResponses / counters.requests,
    avgWaiterWaitMs:
      counters.waiterCount === 0 ? 0 : counters.waiterWaitMsTotal / counters.waiterCount,
  };
}

export function reset(): void {
  for (const key of Object.keys(counters) as CounterName[]) {
    counters[key] = 0;
  }
}
