import { Router } from "express";
import { AppError } from "../../domain/errors.js";
import { createProductInput, productIdParam, updateProductInput } from "@warehouse/shared";
import { runIdempotent } from "../../services/idempotencyService.js";
import * as service from "../../services/productService.js";

export const productRoutes: Router = Router();

function idempotencyKeyFrom(header: unknown): string {
  if (typeof header !== "string" || header.trim().length === 0) {
    throw new AppError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "POST /products requires an Idempotency-Key header.",
    );
  }
  if (header.length > 255) {
    throw new AppError("VALIDATION_FAILED", 400, "Idempotency-Key must be at most 255 characters.");
  }
  return header;
}

productRoutes.get("/", async (_req, res) => {
  res.json(await service.listProducts());
});

productRoutes.get("/:id", async (req, res) => {
  const id = productIdParam.parse(req.params.id);
  res.json(await service.getProduct(id));
});

productRoutes.post("/", async (req, res) => {
  const key = idempotencyKeyFrom(req.get("Idempotency-Key"));
  const input = createProductInput.parse(req.body);

  const result = await runIdempotent(key, input, async (tx) => {
    const product = await service.createProduct(tx, input);
    return { status: 201, body: product, resourceId: product.id };
  });

  // Diagnostic only. Both values are ordinary successes; a client never has to branch on
  // this, which is the point of coalescing duplicates instead of rejecting them.
  res.setHeader("Idempotent-Coalesced", String(result.coalesced));
  res.status(result.status).json(result.body);
});

productRoutes.put("/:id", async (req, res) => {
  const id = productIdParam.parse(req.params.id);
  const input = updateProductInput.parse(req.body);
  res.json(await service.updateProduct(id, input));
});

productRoutes.delete("/:id", async (req, res) => {
  const id = productIdParam.parse(req.params.id);
  await service.deleteProduct(id);
  res.status(204).end();
});
