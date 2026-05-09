FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY bridge.mjs ./
ENV AUTH_DIR=/data/.wa-auth
VOLUME ["/data"]
CMD ["npm", "start"]
