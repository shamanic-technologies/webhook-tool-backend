FROM node:18-slim

WORKDIR /app

# Copy package files first
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Install dependencies for deployment
RUN pnpm install --no-frozen-lockfile

# Copy remaining application code
COPY . .

# Build TypeScript code
RUN pnpm build

# Expose the port
EXPOSE ${PORT:-3001}

# Run migrations automatically on startup
CMD pnpm migrate:up && pnpm start 