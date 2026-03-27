FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build:production

FROM node:20-alpine AS runner

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist-server/index.js"]
