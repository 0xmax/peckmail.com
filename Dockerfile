FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Compile server TypeScript
RUN npx tsc

# Bundle client + CSS
RUN npm run build

# --- Production image ---
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY template-project ./template-project

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
