FROM node:22.18-bookworm-slim
COPY --chown=node:node app /app
COPY --chown=node:node release-receipt.json /app/release-receipt.json
WORKDIR /app
RUN node --check bin/server.mjs
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 A2A_OUTBOUND_TASK_ROOT=/var/lib/inference-market/a2a/outbound INFERENCE_WORK_LOT_DATA_ROOT=/var/lib/inference-market
USER node
EXPOSE 8080
CMD ["node", "bin/server.mjs"]
