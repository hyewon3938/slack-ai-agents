# --- Build Stage ---
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# --- Production Stage ---
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

USER node

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
