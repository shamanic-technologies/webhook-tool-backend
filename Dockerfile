FROM node:18-slim AS base
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm
RUN pnpm install --no-frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm build

FROM node:18-slim AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
