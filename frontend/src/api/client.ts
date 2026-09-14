import type { CreateProductInput, Product, UpdateProductInput } from "@warehouse/shared";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** A stale write: the row moved under us and the edit has to be rebased. */
  get isVersionConflict(): boolean {
    return this.code === "VERSION_CONFLICT";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? response.statusText,
      body?.error?.details,
    );
  }

  return payload as T;
}

export function listProducts(): Promise<Product[]> {
  return request<Product[]>("/products");
}

export function getProduct(id: number): Promise<Product> {
  return request<Product>(`/products/${id}`);
}

/**
 * The key is generated once per logical create and reused by every retry, so a resubmitted
 * form — whether from a double click or a network retry — resolves to the same product.
 */
export function createProduct(input: CreateProductInput, idempotencyKey: string): Promise<Product> {
  return request<Product>("/products", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export function updateProduct(id: number, input: UpdateProductInput): Promise<Product> {
  return request<Product>(`/products/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteProduct(id: number): Promise<void> {
  return request<void>(`/products/${id}`, { method: "DELETE" });
}
