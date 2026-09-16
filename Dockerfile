# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile — .NET 8 Razor Pages web (AFP.csproj only, no AFP.Tests).
#
# Railway picks this up automatically and skips Nixpacks/Railpack builders,
# which were misbehaving by targeting AFP.sln (pulls in test project → fails
# with NETSDK1004).
#
# The Node/Express API in railway-backend/ deploys as a SEPARATE Railway
# service with its own root directory — this Dockerfile is web-only.
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Restore first (better layer caching)
COPY AFP.csproj ./
RUN dotnet restore AFP.csproj

# Copy the rest and publish. We DO NOT copy AFP.sln so the SDK can't
# accidentally include the test project.
COPY . .
RUN rm -f AFP.sln \
 && dotnet publish AFP.csproj -c Release -o /app/publish \
    --no-restore --no-self-contained

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# Railway injects $PORT at runtime; bind Kestrel to it.
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "dotnet AFP.dll --urls http://0.0.0.0:${PORT:-8080}"]
