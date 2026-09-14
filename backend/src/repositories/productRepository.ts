import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Queryable } from "../db/pool.js";
import type { CreateProductInput, Product, ProductFields } from "@warehouse/shared";

/**
 * At `pre-revamp` every SQL string sat inline in an Express handler (server.js:44-121), so
 * the write path could not be exercised without booting an HTTP server. Collecting the
 * statements here gives the service layer a seam it can test directly.
 */

interface ProductRow extends RowDataPacket {
  id: number;
  name: string;
  description: string;
  price: string;
  category: string;
  stock_quantity: number;
  manufacturer: string;
  release_date: string;
  rating: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `id, name, description, price, category, stock_quantity,
                 manufacturer, release_date, rating, version, created_at, updated_at`;

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // mysql2 hands back DECIMAL as a string to avoid the precision loss of a binary float.
    // The value is safe to widen here because the column is capped at 10 digits.
    price: Number(row.price),
    category: row.category,
    stockQuantity: row.stock_quantity,
    manufacturer: row.manufacturer,
    releaseDate: row.release_date,
    rating: Number(row.rating),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toColumnValues(fields: ProductFields): (string | number)[] {
  return [
    fields.name,
    fields.description,
    fields.price,
    fields.category,
    fields.stockQuantity,
    fields.manufacturer,
    fields.releaseDate,
    fields.rating,
  ];
}

export async function findAll(db: Queryable): Promise<Product[]> {
  const [rows] = await db.query<ProductRow[]>(`SELECT ${COLUMNS} FROM product ORDER BY id`);
  return rows.map(toProduct);
}

export async function findById(db: Queryable, id: number): Promise<Product | null> {
  const [rows] = await db.query<ProductRow[]>(`SELECT ${COLUMNS} FROM product WHERE id = ?`, [id]);
  const row = rows[0];
  return row ? toProduct(row) : null;
}

export async function insert(db: Queryable, input: CreateProductInput): Promise<Product> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO product (name, description, price, category, stock_quantity,
                          manufacturer, release_date, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    toColumnValues(input),
  );

  const created = await findById(db, result.insertId);
  if (!created) {
    throw new Error(`Product ${result.insertId} vanished immediately after insert.`);
  }
  return created;
}

/**
 * Returns null when no row matched, which means either the product is gone or another
 * request already bumped the version. The caller disambiguates; the distinction matters
 * because one is a 404 and the other a 409.
 */
export async function updateIfVersionMatches(
  db: Queryable,
  id: number,
  fields: ProductFields,
  expectedVersion: number,
): Promise<Product | null> {
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE product
        SET name = ?, description = ?, price = ?, category = ?, stock_quantity = ?,
            manufacturer = ?, release_date = ?, rating = ?, version = version + 1
      WHERE id = ? AND version = ?`,
    [...toColumnValues(fields), id, expectedVersion],
  );

  if (result.affectedRows === 0) {
    return null;
  }
  return findById(db, id);
}

export async function deleteById(db: Queryable, id: number): Promise<boolean> {
  const [result] = await db.execute<ResultSetHeader>("DELETE FROM product WHERE id = ?", [id]);
  return result.affectedRows > 0;
}
