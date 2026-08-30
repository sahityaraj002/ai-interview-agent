# Development-oriented container reference.
# For the assignment demo, run the three services separately as described in README.md.
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install
COPY backend ./backend
EXPOSE 3001
CMD ["npm", "--prefix", "backend", "start"]
