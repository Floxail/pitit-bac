# Backend websocket server.
# Build context must be the repository root (back depends on the local
# commons and munin packages).
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY commons/ commons/
COPY munin/ munin/
COPY back/ back/

WORKDIR /app/back
RUN npm install --omit=dev --no-audit --no-fund

# Cumulative statistics are written here — mounted as a volume.
RUN mkdir -p /app/back/data && chown -R node:node /app/back

USER node

EXPOSE 62868

CMD ["node", "index.js"]
