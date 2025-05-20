FROM node:18-slim AS base

# Set working directory
WORKDIR /app

# Copy package.json and lockfile
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm

# Install dependencies with production flag
RUN pnpm install --prod --frozen-lockfile

# Build stage
FROM base AS build

# Install all dependencies for build
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Production stage
FROM node:18-slim AS production

WORKDIR /app

# Copy built files and dependencies from previous stages
COPY --from=build /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY package.json ./

# Copy migrations folder
COPY migrations ./migrations

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Run migrations and start server
CMD ["sh", "-c", "node dist/index.js"] 