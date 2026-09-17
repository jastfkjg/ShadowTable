FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/shadowtable.sqlite
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "server/index.js"]
