FROM node:22-alpine

# node-pty needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy server
COPY server/package*.json ./
RUN npm ci --omit=dev

COPY server/dist ./dist

# Bundled PI extensions (synced into user workspaces at runtime)
COPY pi-extensions ./pi-extensions

# Copy built client as static files
COPY client/dist ./public

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV PI_EXTENSIONS_ROOT=/app/pi-extensions

CMD ["node", "dist/index.js"]
