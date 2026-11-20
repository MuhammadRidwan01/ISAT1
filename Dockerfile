FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN mkdir -p dist/db/migrations && cp src/db/migrations/*.sql dist/db/migrations/

FROM node:22-alpine AS proddeps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM alpine:3.20
RUN apk add --no-cache libstdc++ libgcc
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
RUN addgroup -S app && adduser -S app -G app
USER app
EXPOSE 8080
CMD ["./entrypoint.sh"]