# Static front, built then served by nginx.
# Build context must be the repository root.
FROM node:20-alpine AS build

# morel-games-core is fetched from GitHub.
RUN apk add --no-cache git

WORKDIR /app

COPY commons/ commons/
COPY front/ front/

WORKDIR /app/front
RUN npm install --no-audit --no-fund

# Public URL of the game (og:image previews). Overrides .env.production.
ARG VUE_APP_URL=https://pitit-bac.floxail.fr
ENV VUE_APP_URL=$VUE_APP_URL

RUN npm run build

FROM nginx:alpine

COPY docker/front-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/front/dist-build /usr/share/nginx/html

EXPOSE 80
