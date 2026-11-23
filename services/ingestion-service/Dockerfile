FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm fetch --frozen-lockfile
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm exec turbo run build --filter=@roottracer/ingestion-service...
RUN pnpm --filter=@roottracer/ingestion-service deploy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4002
CMD ["node", "dist/server.js"]
