import { pool, type Queryable } from "../db/pool.js";
import { NotFoundError, VersionConflictError } from "../domain/errors.js";
import type {
  CreateProductInput,
  Page,
  Product,
  ProductQuery,
  UpdateProductInput,
} from "@warehouse/shared";
import * as products from "../repositories/productRepository.js";

export async function listProducts(query: ProductQuery): Promise<Page<Product>> {
  const [items, total] = await Promise.all([
    products.findPage(pool, query.limit, query.offset),
    products.count(pool),
  ]);
  return { items, total, limit: query.limit, offset: query.offset };
}

export async function getProduct(id: number): Promise<Product> {
  const product = await products.findById(pool, id);
  if (!product) throw new NotFoundError(id);
  return product;
}

/**
 * Takes its connection from the caller so the insert can join the transaction that also
 * re-checks idempotency-key ownership. If this ran on the pool instead, a leader whose lease
 * had been stolen would still commit a duplicate row.
 */
export function createProduct(db: Queryable, input: CreateProductInput): Promise<Product> {
  return products.insert(db, input);
}

export async function updateProduct(id: number, input: UpdateProductInput): Promise<Product> {
  const { expectedVersion, ...fields } = input;
  const updated = await products.updateIfVersionMatches(pool, id, fields, expectedVersion);
  if (updated) return updated;

  // No row matched, which is either a missing product or a stale version. One read tells
  // them apart, and the answers differ: 404 is terminal, 409 is retryable after a re-read.
  const current = await products.findById(pool, id);
  if (!current) throw new NotFoundError(id);
  throw new VersionConflictError(id, expectedVersion, current.version);
}

export async function deleteProduct(id: number): Promise<void> {
  const deleted = await products.deleteById(pool, id);
  if (!deleted) throw new NotFoundError(id);
}
