FROM node:18-slim AS base
WORKDIR /app

# Copy package.json and pnpm-lock.yaml (if you intend to commit it after a successful local install without overrides)
# If pnpm-lock.yaml is not present or might be stale, just copy package.json
COPY package.json ./
# COPY pnpm-lock.yaml ./

RUN npm install -g pnpm
# Install dependencies. This will generate a pnpm-lock.yaml if not present.
RUN pnpm install --no-frozen-lockfile

FROM base AS build
# node_modules are already correctly installed in the base stage
COPY . .
RUN pnpm build

FROM node:18-slim AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY migrations ./migrations

# Run database migrations
RUN pnpm migrate:up

# service-account-key.json and GOOGLE_APPLICATION_CREDENTIALS will be handled by Railway

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
