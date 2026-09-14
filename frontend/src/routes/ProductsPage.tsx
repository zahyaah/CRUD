import type { Product, ProductFields } from "@warehouse/shared";
import { useState } from "react";
import { ApiError } from "../api/client";
import { ProductForm, toDraft } from "../components/ProductForm";
import { PAGE_SIZE, useDeleteProduct, useProducts, useUpdateProduct } from "../hooks/useProducts";

export function ProductsPage() {
  const [offset, setOffset] = useState(0);
  const { data: page, isPending, isError, error } = useProducts(offset);
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const [editing, setEditing] = useState<Product | null>(null);

  const conflict = update.error instanceof ApiError && update.error.isVersionConflict;

  function handleUpdate(fields: ProductFields) {
    if (!editing) return;
    update.mutate(
      { id: editing.id, input: { ...fields, expectedVersion: editing.version } },
      { onSuccess: () => setEditing(null) },
    );
  }

  if (isPending) return <p className="muted">Loading inventory…</p>;

  if (isError) {
    return (
      <p className="alert alert--error" role="alert">
        {error instanceof ApiError ? error.message : "Could not load products."}
      </p>
    );
  }

  return (
    <section className="stack">
      <header className="page-head">
        <h1 className="page-head__title">Inventory</h1>
        <p className="page-head__sub">
          {page.total} {page.total === 1 ? "product" : "products"}
          {page.total > page.items.length &&
            ` (showing ${page.offset + 1}\u2013${page.offset + page.items.length})`}
        </p>
      </header>

      {page.items.length === 0 ? (
        <p className="empty">No products yet. Add one to get started.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Products currently in the warehouse</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col" className="table__num">Price</th>
                <th scope="col" className="table__num">Stock</th>
                <th scope="col" className="table__num">Rating</th>
                <th scope="col" className="table__num">Ver.</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((product) => (
                <tr key={product.id}>
                  <td>
                    <span className="table__name">{product.name}</span>
                    <span className="table__meta">{product.manufacturer}</span>
                  </td>
                  <td>{product.category}</td>
                  <td className="table__num">{product.price.toFixed(2)}</td>
                  <td className="table__num">{product.stockQuantity}</td>
                  <td className="table__num">{product.rating.toFixed(1)}</td>
                  <td className="table__num">
                    <span className="badge">v{product.version}</span>
                  </td>
                  <td className="table__actions">
                    <button className="button" onClick={() => setEditing(product)}>
                      Edit<span className="visually-hidden"> {product.name}</span>
                    </button>
                    <button
                      className="button button--danger"
                      onClick={() => remove.mutate(product.id)}
                      disabled={remove.isPending}
                    >
                      Delete<span className="visually-hidden"> {product.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page.total > PAGE_SIZE && (
        <nav className="pager" aria-label="Inventory pages">
          <button
            className="button"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
          >
            Previous
          </button>
          <span className="muted" aria-live="polite">
            Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(page.total / PAGE_SIZE)}
          </span>
          <button
            className="button"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= page.total}
          >
            Next
          </button>
        </nav>
      )}

      {editing && (
        <section className="panel" aria-label={`Edit ${editing.name}`}>
          <div className="panel__head">
            <h2 className="panel__title">
              Edit {editing.name} <span className="badge">v{editing.version}</span>
            </h2>
            <button className="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>

          {conflict && (
            <div className="alert alert--warn" role="alert">
              <strong>Someone else changed this product.</strong>
              <p>
                {update.error instanceof ApiError ? update.error.message : null} The table above has
                been refreshed. Reopen the row to edit the current values.
              </p>
            </div>
          )}

          {update.isError && !conflict && (
            <p className="alert alert--error" role="alert">
              {update.error instanceof ApiError ? update.error.message : "Update failed."}
            </p>
          )}

          <ProductForm
            initial={toDraft(editing)}
            submitLabel="Save changes"
            pending={update.isPending}
            onSubmit={handleUpdate}
          />
        </section>
      )}
    </section>
  );
}
