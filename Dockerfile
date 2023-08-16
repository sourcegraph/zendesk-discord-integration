FROM cgr.dev/chainguard/node:latest

COPY . .

RUN npm i
RUN npm run build

EXPOSE 8080
CMD ["dist/src/index.js"]
