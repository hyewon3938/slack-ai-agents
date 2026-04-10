# syntax=docker/dockerfile:1.6

# --- Build Stage ---
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN yarn build

# --- Production Stage ---
FROM node:22-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY db/ ./db/

USER node

CMD ["node", "dist/app.js"]
