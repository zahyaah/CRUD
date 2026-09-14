import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ConcurrencyLabPage } from "./routes/ConcurrencyLabPage";
import { NewProductPage } from "./routes/NewProductPage";
import { ProductsPage } from "./routes/ProductsPage";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1 },
    // Retrying a mutation is only safe because POST carries an idempotency key; without one
    // a retried create would insert twice.
    mutations: { retry: 0 },
  },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <ProductsPage /> },
      { path: "new", element: <NewProductPage /> },
      { path: "lab", element: <ConcurrencyLabPage /> },
    ],
  },
]);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
