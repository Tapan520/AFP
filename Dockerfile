# syntax=docker/dockerfile:1.6
# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile — Single-container deploy for Railway.
#
# Runs BOTH processes in one container:
#   • Node/Express API  (railway-backend/)          → listens on 127.0.0.1:3000
#   • .NET 8 Razor Pages web (AFP.csproj)           → listens on 0.0.0.0:$PORT
#
# .NET reverse-proxies /api/* and /uploads/* to http://localhost:3000, so the
# public traffic only ever hits Kestrel. Simpler for launch; split into two
# Railway services later when you need independent scaling.
#
# We DELIBERATELY skip AFP.Tests + AFP.sln to avoid NETSDK1004 during publish.
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage (.NET) ───────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY AFP.csproj ./
RUN dotnet restore AFP.csproj

COPY . .
RUN rm -f AFP.sln \
 && dotnet publish AFP.csproj -c Release -o /app/publish \
    --no-restore --no-self-contained

# ── Runtime stage (.NET aspnet + Node.js) ────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Install Node.js 20 (LTS) alongside .NET.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# .NET publish output
COPY --from=build /app/publish ./web

# Node backend (install deps inside the image)
COPY railway-backend ./api
WORKDIR /app/api
RUN npm ci --omit=dev

WORKDIR /app

# Small entrypoint script: start Node, then .NET; forward SIGTERM to both.
COPY <<'EOF' /app/start.sh
#!/usr/bin/env bash
set -euo pipefail

# ── Node API on internal port 3000 ───────────────────────────────────────────
export NODE_PORT="${NODE_PORT:-3000}"
export PORT_NODE="$NODE_PORT"    # some scripts read PORT_NODE
(
  cd /app/api
  PORT="$NODE_PORT" node server.js
) &
NODE_PID=$!

# Wait briefly so the API is ready before Kestrel starts serving.
sleep 2

# ── .NET web on Railway's public $PORT ───────────────────────────────────────
export ApiProxy__BaseUrl="http://127.0.0.1:${NODE_PORT}"
cd /app/web
dotnet AFP.dll --urls "http://0.0.0.0:${PORT:-8080}" &
DOTNET_PID=$!

# Forward signals + exit when either process dies.
trap 'kill -TERM $NODE_PID $DOTNET_PID 2>/dev/null || true' TERM INT
wait -n $NODE_PID $DOTNET_PID
EXIT=$?
kill -TERM $NODE_PID $DOTNET_PID 2>/dev/null || true
exit $EXIT
EOF
RUN chmod +x /app/start.sh

EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]
