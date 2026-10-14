# EcoFlow BLE bridge: eflib from rabits/ha-ef-ble (Apache-2.0) behind a small HTTP API.
# Talks to the host's bluetoothd over the mounted system D-Bus socket, so the
# container needs neither host networking nor privileged mode.

FROM python:3.13-slim AS eflib
# Pinned commit; git verifies the content by its hash.
ARG EFLIB_REPO=https://github.com/rabits/ha-ef-ble
ARG EFLIB_COMMIT=71f5b90a23dce7acdf7b8d701460de59f6d3b0f6
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . \
 && git fetch -q --depth 1 "$EFLIB_REPO" "$EFLIB_COMMIT" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "$EFLIB_COMMIT"

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=eflib /src/custom_components/ef_ble/eflib ./eflib
COPY --from=eflib /src/LICENSE ./eflib/LICENSE
COPY quota.py bridge.py ./

# Runs as root: BlueZ's D-Bus policy only lets root (or the host's bluetooth group)
# talk to bluetoothd, and the group id differs between hosts.
VOLUME /data
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=4)"
CMD ["python", "bridge.py"]
