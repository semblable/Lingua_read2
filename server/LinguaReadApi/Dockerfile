# -------- Build Stage --------
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy csproj and restore as distinct layers
COPY LinguaReadApi.csproj ./
RUN dotnet restore LinguaReadApi.csproj

# Copy the rest of the source code
COPY . ./

# Publish the application
RUN dotnet publish LinguaReadApi.csproj -c Release -o /app/publish

# -------- Runtime Stage --------
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

# Copy published output from build stage
COPY --from=build /app/publish ./

# Install PostgreSQL client for pg_dump and pg_restore
USER root
RUN apt-get update && \
    # Add PostgreSQL repo setup for version 16 client tools
    # Install lsb-release first to get codename - No longer needed, hardcoding bookworm
    apt-get install -y --no-install-recommends curl ca-certificates gnupg lsb-release && \
    curl https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list && \
    apt-get update && \
    # Install specific client version
    apt-get install -y --no-install-recommends postgresql-client-16 && \
    rm -rf /var/lib/apt/lists/* # Clean up

# Create the directories the application needs at runtime and ensure correct ownership
RUN mkdir -p /app/wwwroot/audio_lessons /app/wwwroot/audiobooks && \
    chown -R app:app /app/wwwroot/audio_lessons /app/wwwroot/audiobooks

# Change ownership of the rest of the app directory to the app user
RUN chown -R app:app /app

USER app

# Expose port 5000 (as set in Program.cs)
EXPOSE 5000

# Set environment variables for ASP.NET Core
ENV ASPNETCORE_URLS=http://+:5000

# Entrypoint
ENTRYPOINT ["dotnet", "LinguaReadApi.dll"]