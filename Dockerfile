FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000 STATE_FILE=/data/state.json
EXPOSE 3000
CMD ["npx", "eve", "start", "--host", "0.0.0.0"]
