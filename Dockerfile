FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Le fichier SQLite est stocké ici — montez un volume sur ce chemin pour ne pas perdre les
# données à chaque redéploiement (voir docker-compose.yml et le README de déploiement).
ENV DB_FILE=/app/data/tracalinge.db
VOLUME ["/app/data"]

EXPOSE 4000
CMD ["node", "src/server.js"]
