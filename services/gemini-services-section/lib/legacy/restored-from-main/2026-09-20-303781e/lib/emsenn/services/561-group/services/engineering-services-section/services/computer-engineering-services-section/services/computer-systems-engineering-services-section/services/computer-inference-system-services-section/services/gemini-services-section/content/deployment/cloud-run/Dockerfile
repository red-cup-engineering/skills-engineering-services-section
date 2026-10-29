ARG BASE_IMAGE=us-central1-docker.pkg.dev/five-six-one-group-dev/capability-cells/gemini-inference-team@sha256:78d92aadcdf4b51abb3607e23dbcf9fdc0c8ff61de7e211bd227755f417dee91
FROM ${BASE_IMAGE}

USER root
COPY content/deployment/cloud-run/patch-json-output.cjs /tmp/patch-json-output.cjs
RUN node /tmp/patch-json-output.cjs && rm /tmp/patch-json-output.cjs
USER node
