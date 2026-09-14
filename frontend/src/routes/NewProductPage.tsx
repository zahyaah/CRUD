import type { ProductFields } from "@warehouse/shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { ProductForm } from "../components/ProductForm";
import { useCreateProduct } from "../hooks/useProducts";

export function NewProductPage() {
  const navigate = useNavigate();
  const create = useCreateProduct();

  // Generated once per form instance, not per submit. A double click, an impatient retry
  // and a network-level replay all carry this same key, so the server resolves them to one
  // product instead of three.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  function handleSubmit(fields: ProductFields) {
    create.mutate(
      { input: fields, idempotencyKey },
      {
        onSuccess: () => {
          setIdempotencyKey(crypto.randomUUID());
          void navigate("/");
        },
        // A failed attempt leaves the key bound to the body that failed. Reusing it after the
        // user edits the form would be key reuse with a different payload, which the server
        // rejects with 422 forever. Retrying the *same* body is still safe: the mutation
        // itself is what carries the key, and this only runs once it has settled.
        onError: () => setIdempotencyKey(crypto.randomUUID()),
      },
    );
  }

  return (
    <section className="stack">
      <header className="page-head">
        <h1 className="page-head__title">Add product</h1>
        <p className="page-head__sub">
          This form sends an <code>Idempotency-Key</code>. Submitting twice creates one product.
        </p>
      </header>

      {create.isError && (
        <p className="alert alert--error" role="alert">
          {create.error instanceof ApiError ? create.error.message : "Something went wrong."}
        </p>
      )}

      <ProductForm submitLabel="Create product" pending={create.isPending} onSubmit={handleSubmit} />

      <p className="muted">
        Key for this form: <code>{idempotencyKey}</code>
      </p>
    </section>
  );
}
