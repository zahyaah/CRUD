import { type ProductFields, productFields } from "@warehouse/shared";
import { type FormEvent, useState } from "react";
import { Field } from "./Field";

type Draft = Record<keyof ProductFields, string>;

const EMPTY: Draft = {
  name: "",
  description: "",
  price: "",
  category: "",
  stockQuantity: "",
  manufacturer: "",
  releaseDate: "",
  rating: "",
};

/** Inputs always yield strings; the schema owns every rule about what those strings mean. */
function toTypedFields(draft: Draft): Record<string, unknown> {
  return {
    ...draft,
    price: draft.price === "" ? undefined : Number(draft.price),
    stockQuantity: draft.stockQuantity === "" ? undefined : Number(draft.stockQuantity),
    rating: draft.rating === "" ? undefined : Number(draft.rating),
  };
}

export function toDraft(fields: ProductFields): Draft {
  return {
    name: fields.name,
    description: fields.description,
    price: String(fields.price),
    category: fields.category,
    stockQuantity: String(fields.stockQuantity),
    manufacturer: fields.manufacturer,
    releaseDate: fields.releaseDate,
    rating: String(fields.rating),
  };
}

interface ProductFormProps {
  initial?: Draft;
  submitLabel: string;
  pending: boolean;
  onSubmit: (fields: ProductFields) => void;
}

export function ProductForm({ initial, submitLabel, pending, onSubmit }: ProductFormProps) {
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof ProductFields, string>>>({});

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    // The client runs the server's schema rather than a hand-written copy of its rules, so
    // the two cannot drift apart and disagree about what is valid.
    const parsed = productFields.safeParse(toTypedFields(draft));

    if (!parsed.success) {
      const next: Partial<Record<keyof ProductFields, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ProductFields | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    onSubmit(parsed.data);
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="form__grid">
        <Field label="Name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              value={draft.name}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("name")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Category" error={errors.category}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              value={draft.category}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("category")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Price" hint="Up to two decimal places" error={errors.price}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={draft.price}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("price")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Stock quantity" error={errors.stockQuantity}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="number"
              inputMode="numeric"
              value={draft.stockQuantity}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("stockQuantity")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Manufacturer" error={errors.manufacturer}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              value={draft.manufacturer}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("manufacturer")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Release date" error={errors.releaseDate}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="date"
              value={draft.releaseDate}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("releaseDate")(e.target.value)}
            />
          )}
        </Field>

        <Field label="Rating" hint="Between 1 and 5" error={errors.rating}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input"
              type="number"
              step="0.1"
              min="1"
              max="5"
              value={draft.rating}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => set("rating")(e.target.value)}
            />
          )}
        </Field>
      </div>

      <Field label="Description" error={errors.description}>
        {({ id, describedBy, invalid }) => (
          <textarea
            id={id}
            className="input input--area"
            rows={3}
            value={draft.description}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => set("description")(e.target.value)}
          />
        )}
      </Field>

      <button className="button button--primary" type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
