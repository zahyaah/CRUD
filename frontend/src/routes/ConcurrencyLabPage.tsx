import type { CreateProductInput } from "@warehouse/shared";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiUrl, countProducts } from "../api/client";

interface Attempt {
  index: number;
  status: number;
  coalesced: boolean;
  ms: number;
}

interface Outcome {
  key: string;
  attempts: Attempt[];
  productsBefore: number;
  productsAfter: number;
}

function sampleProduct(label: string): CreateProductInput {
  return {
    name: `Burst ${label}`,
    description: "Created by the concurrency lab",
    price: 24.99,
    category: "demo",
    stockQuantity: 3,
    manufacturer: "Acme",
    releaseDate: "2024-06-01",
    rating: 4.2,
  };
}

/**
 * Fires the burst with a bare fetch rather than the typed client, because the demo's whole
 * point is the Idempotent-Coalesced response header, which the client deliberately discards.
 */
async function fire(key: string, body: CreateProductInput, index: number): Promise<Attempt> {
  const startedAt = performance.now();
  const response = await fetch(apiUrl("/products"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });

  return {
    index,
    status: response.status,
    coalesced: response.headers.get("Idempotent-Coalesced") === "true",
    ms: Math.round(performance.now() - startedAt),
  };
}

export function ConcurrencyLabPage() {
  const queryClient = useQueryClient();
  const [duplicates, setDuplicates] = useState(8);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function runBurst() {
    setRunning(true);
    setOutcome(null);

    const key = crypto.randomUUID();
    const body = sampleProduct(key.slice(0, 8));

    try {
      const productsBefore = await countProducts();
      const attempts = await Promise.all(
        Array.from({ length: duplicates }, (_, i) => fire(key, body, i + 1)),
      );
      const productsAfter = await countProducts();

      setOutcome({ key, attempts, productsBefore, productsAfter });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    } finally {
      setRunning(false);
    }
  }

  const leaders = outcome?.attempts.filter((a) => !a.coalesced).length ?? 0;
  const coalesced = outcome?.attempts.filter((a) => a.coalesced).length ?? 0;
  const rowsAdded = outcome ? outcome.productsAfter - outcome.productsBefore : 0;

  return (
    <section className="stack">
      <header className="page-head">
        <h1 className="page-head__title">Concurrency lab</h1>
        <p className="page-head__sub">
          Fires simultaneous identical creates sharing one <code>Idempotency-Key</code>: a
          double-clicked submit, exaggerated. However many go out, one product comes back.
        </p>
      </header>

      <div className="controls">
        <label className="controls__label" htmlFor="duplicates">
          Concurrent duplicates: <strong>{duplicates}</strong>
        </label>
        <input
          id="duplicates"
          className="controls__range"
          type="range"
          min={2}
          max={16}
          value={duplicates}
          onChange={(e) => setDuplicates(Number(e.target.value))}
          disabled={running}
        />
        <button className="button button--primary" onClick={() => void runBurst()} disabled={running}>
          {running ? "Firing…" : "Fire burst"}
        </button>
      </div>

      <div aria-live="polite">
        {outcome && (
          <div className="stack">
            <div className="scoreboard">
              <div className="score">
                <span className="score__value">{outcome.attempts.length}</span>
                <span className="score__label">requests sent</span>
              </div>
              <div className="score">
                <span className="score__value">{leaders}</span>
                <span className="score__label">executed the work</span>
              </div>
              <div className="score">
                <span className="score__value">{coalesced}</span>
                <span className="score__label">coalesced onto it</span>
              </div>
              <div className={`score ${rowsAdded === 1 ? "score--good" : "score--bad"}`}>
                <span className="score__value">{rowsAdded}</span>
                <span className="score__label">products created</span>
              </div>
            </div>

            <p className="muted">
              Key: <code>{outcome.key}</code>
            </p>

            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Result of each concurrent request</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">HTTP status</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="table__num">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.attempts.map((attempt) => (
                    <tr key={attempt.index}>
                      <td>{attempt.index}</td>
                      <td>{attempt.status}</td>
                      <td>
                        <span className={`badge ${attempt.coalesced ? "" : "badge--accent"}`}>
                          {attempt.coalesced ? "waiter" : "leader"}
                        </span>
                      </td>
                      <td className="table__num">{attempt.ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
