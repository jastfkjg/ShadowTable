FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DB_PATH=/data/shadowtable.sqlite
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node miniprogram/builtin-avatars.js ./miniprogram/builtin-avatars.js
COPY --chown=node:node miniprogram/avatar-library.js ./miniprogram/avatar-library.js
COPY --chown=node:node miniprogram/fun-copy.js ./miniprogram/fun-copy.js
COPY --chown=node:node miniprogram/badges.js ./miniprogram/badges.js
COPY --chown=node:node miniprogram/badge-awards.js miniprogram/badge-awards.wxss ./miniprogram/
COPY --chown=node:node miniprogram/board-detail.js ./miniprogram/board-detail.js
COPY --chown=node:node miniprogram/avoidance.js miniprogram/avoidance.wxss miniprogram/role-portraits.js ./miniprogram/
COPY --chown=node:node miniprogram/pages/badges/badges.wxss ./miniprogram/pages/badges/badges.wxss
COPY --chown=node:node miniprogram/honors.js miniprogram/honors.wxss ./miniprogram/
COPY --chown=node:node miniprogram/match-story.wxss ./miniprogram/
COPY --chown=node:node miniprogram/result-registration.js miniprogram/leaderboard-presentation.js miniprogram/public-history.js ./miniprogram/
COPY --chown=node:node miniprogram/room-swipe.js miniprogram/monthly-report.js miniprogram/monthly-report-card.js miniprogram/poster-canvas.js ./miniprogram/
COPY --chown=node:node miniprogram/room-list.js miniprogram/room-list.wxss miniprogram/room-menu.wxss ./miniprogram/
COPY --chown=node:node miniprogram/room-confirmation.js miniprogram/room-confirmation.wxss ./miniprogram/
COPY --chown=node:node miniprogram/identity-vision.js miniprogram/identity-vision.wxss ./miniprogram/
COPY --chown=node:node miniprogram/assets/roles/*.png ./miniprogram/assets/roles/
COPY --chown=node:node miniprogram/assets/table-cards.svg ./miniprogram/assets/
COPY --chown=node:node miniprogram/assets/monthly-report-background.jpg ./miniprogram/assets/monthly-report-background.jpg
COPY --chown=node:node miniprogram/assets/monthly-*.svg miniprogram/assets/board-search.svg miniprogram/assets/board-directory.svg ./miniprogram/assets/
COPY --chown=node:node miniprogram/assets/record-info.svg miniprogram/assets/record-heart.svg miniprogram/assets/record-sword.svg miniprogram/assets/record-swords.svg miniprogram/assets/record-shield.svg miniprogram/assets/record-spark.svg miniprogram/assets/record-medal.svg miniprogram/assets/record-users.svg ./miniprogram/assets/
COPY --chown=node:node miniprogram/assets/home-table-blue.svg miniprogram/assets/home-refresh.svg miniprogram/assets/home-clock.svg miniprogram/assets/record-more.svg miniprogram/assets/room-menu-remove.svg miniprogram/assets/room-menu-leave.svg miniprogram/assets/room-menu-delete.svg ./miniprogram/assets/
COPY --chown=node:node miniprogram/assets/badges ./miniprogram/assets/badges
COPY --chown=node:node miniprogram/pages/profile/assets/avatars ./miniprogram/pages/profile/assets/avatars
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "server/index.js"]
