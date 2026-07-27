FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV DB_FILE=/app/data/tracalinge.db

EXPOSE 4000
CMD ["node", "src/server.js"]
