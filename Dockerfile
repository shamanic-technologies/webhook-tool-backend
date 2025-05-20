FROM node:18-slim AS base
WORKDIR /app
COPY package.json .

# Modify package.json to replace the content of "overrides" with an empty object
# This prevents pnpm from trying to resolve "workspace:*" in Docker
# This command assumes the "overrides" block starts with a line matching '^"overrides": {'
# and ends with a line matching '^}'
RUN sed -i '/^"overrides": {/,/^}/c\    "overrides": {}' package.json

RUN npm install -g pnpm
# Do NOT copy pnpm-lock.yaml; a new one will be generated based on the modified package.json
RUN pnpm install --no-frozen-lockfile

FROM base AS build
COPY . .
RUN pnpm build

FROM node:18-slim AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json .
COPY migrations ./migrations

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
