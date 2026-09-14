import type { CreateProductInput, Product, UpdateProductInput } from "@warehouse/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/client";

const productsKey = ["products"] as const;

export function useProducts() {
  return useQuery({ queryKey: productsKey, queryFn: api.listProducts });
}

export function useProduct(id: number) {
  return useQuery({ queryKey: [...productsKey, id], queryFn: () => api.getProduct(id) });
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
    onSuccess: (updated) => {
      queryClient.setQueryData<Product[]>(productsKey, (current) =>
        current?.map((p) => (p.id === updated.id ? updated : p)),
      );
    },
    // A 409 means the server holds a newer row than the one being edited. Refetching makes
    // the current values available so the user can rebase rather than guess.
    onError: () => queryClient.invalidateQueries({ queryKey: productsKey }),
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: productsKey }),
  });
}
