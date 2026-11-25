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

# 운영 이미지 표시. SQL 도구 전용 연결이 필수가 된다 (src/shared/config.ts sqlToolRequired)
ENV NODE_ENV=production

COPY package.json yarn.lock ./
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn,sharing=locked \
    yarn install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY db/ ./db/

USER node

CMD ["node", "dist/app.js"]
