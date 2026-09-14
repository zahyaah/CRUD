import type { CreateProductInput, UpdateProductInput } from "@warehouse/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/client";

const productsKey = ["products"] as const;

export const PAGE_SIZE = 50;

export function useProducts(offset: number) {
  return useQuery({
    queryKey: [...productsKey, { offset }],
    queryFn: () => api.listProducts(PAGE_SIZE, offset),
    // Keeps the current page on screen while the next one loads, instead of flashing the
    // loading state on every page change.
    placeholderData: (previous) => previous,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateProductInput; idempotencyKey: string }) =>
      api.createProduct(input, idempotencyKey),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productsKey }),
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateProductInput }) =>
      api.updateProduct(id, input),
    // Refetch on failure as well as success: a 409 means the server holds a newer row than
    // the one being edited, and the user needs the current values to rebase onto.
    onSettled: () => queryClient.invalidateQueries({ queryKey: productsKey }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productsKey }),
  });
}
