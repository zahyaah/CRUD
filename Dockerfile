# Build stage: compiles the shared contract, then the API that depends on it.
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a dependency install is only redone when a manifest changes.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

COPY shared/ shared/
COPY backend/ backend/
RUN npm run build --workspace=shared && npm run build --workspace=backend

# Runtime stage: production dependencies and compiled output only. No sources, no toolchain.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Scoped to the API's workspace so the UI's React tree never reaches this image. The root is
# included because the workspace symlink to @warehouse/shared lives in the root node_modules.
RUN npm ci --omit=dev --workspace=backend --include-workspace-root && npm cache clean --force

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist

USER node
EXPOSE 3000

# --env-file-if-exists, not --env-file: a platform supplies real environment variables and
# there is no .env file in the image, which the strict flag treats as fatal.
CMD ["node", "--env-file-if-exists=.env", "backend/dist/server.js"]
