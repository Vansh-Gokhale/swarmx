FROM node:20-slim AS builder

WORKDIR /app

# Install ALL dependencies (including devDependencies for tsc)
COPY package*.json ./
RUN npm ci

# Copy source, IDL, and tsconfig
COPY tsconfig.json ./
COPY src/ ./src/
COPY idl/ ./idl/

# Compile TypeScript
RUN npx tsc

# ── Production image ─────────────────────────────────────────────────────────
FROM node:20-slim

# Install Chromium and fonts for Puppeteer browser automation
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcups2 \
    libnss3 \
    libxss1 \
    --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled JS from builder
COPY --from=builder /app/dist/ ./dist/

# Copy IDL files (needed at runtime by the compiled JS)
COPY idl/ ./idl/

EXPOSE 3009

CMD ["node", "dist/index.js"]
