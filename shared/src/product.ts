import { z } from "zod";

/**
 * At `pre-revamp` the nine product fields were re-declared by hand in eight places across
 * backend and frontend, so adding a column meant eight coordinated edits with nothing to
 * catch a miss. This module is the single declaration, and it sits in a shared package so
 * the API and the UI compile against the same one rather than two copies that can drift.
 */

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be formatted YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "is not a real calendar date");

const money = z
  .number()
  .finite()
  .positive()
  .max(99_999_999.99)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9,
    "must have at most 2 decimal places",
  );

export const productFields = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(65_535),
  price: money,
  category: z.string().trim().min(1).max(100),
  stockQuantity: z.number().int().nonnegative().max(4_294_967_295),
  manufacturer: z.string().trim().min(1).max(255),
  releaseDate: calendarDate,
  rating: z.number().min(1).max(5),
});

export const createProductInput = productFields;

/**
 * `expectedVersion` is the version the client read before editing. The update only applies
 * if the row is still at that version, which is what turns a silent overwrite into a
 * reportable 409.
 */
export const updateProductInput = productFields.extend({
  expectedVersion: z.number().int().positive(),
});

export const productIdParam = z.coerce.number().int().positive();

export type ProductFields = z.infer<typeof productFields>;
export type CreateProductInput = z.infer<typeof createProductInput>;
export type UpdateProductInput = z.infer<typeof updateProductInput>;

export interface Product extends ProductFields {
  id: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
