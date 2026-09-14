import type { ReactNode } from "react";
import { useId } from "react";

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Wires the label, hint and error text to the control with generated ids, so the accessible
 * name and description stay correct without every caller hand-managing aria attributes.
 */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}

      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
