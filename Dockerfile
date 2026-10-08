FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/shadowtable.sqlite
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node miniprogram/builtin-avatars.js ./miniprogram/builtin-avatars.js
COPY --chown=node:node miniprogram/avatar-library.js ./miniprogram/avatar-library.js
COPY --chown=node:node miniprogram/fun-copy.js ./miniprogram/fun-copy.js
COPY --chown=node:node miniprogram/result-registration.js miniprogram/leaderboard-presentation.js miniprogram/public-history.js ./miniprogram/
COPY --chown=node:node miniprogram/pages/profile/assets/avatars ./miniprogram/pages/profile/assets/avatars
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "server/index.js"]
