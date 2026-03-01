# Stage 1: Web builder
FROM node:22-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Backend builder
FROM node:22-alpine AS backend-builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY config/ ./config/
COPY skills/ ./skills/
COPY tsconfig.json ./
RUN npm run build

# Stage 3: Runner (minimal image)
FROM node:22-alpine AS runner
WORKDIR /app

COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./
COPY --from=backend-builder /app/config ./config
COPY --from=backend-builder /app/skills ./skills
COPY --from=web-builder /app/web/out ./web/out

RUN mkdir -p data

VOLUME ["/app/data"]
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "--experimental-sqlite", "dist/index.js"]
