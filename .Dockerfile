FROM node:20.18-alpine as builder

COPY . .

RUN npm ci --omit=dev
RUN npm run build

FROM  node:20.18-alpine as runner

COPY --from=builder /dist ./dist

WORKDIR /dist

EXPOSE 3000

CMD ["node", "server.js"]
