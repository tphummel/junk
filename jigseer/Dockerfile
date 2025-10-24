FROM dunglas/frankenphp:1.9.1-php8.2.29-alpine

WORKDIR /app

# Copy only the files needed to run the application inside the image.
COPY Caddyfile /app/Caddyfile
COPY public/ /app/public/
COPY src/ /app/src/
COPY templates/ /app/templates/

RUN mkdir -p /app/var \
    && chown -R www-data:www-data /app/var

ENV SERVER_NAME=:8080

CMD ["frankenphp", "run", "--config", "/app/Caddyfile"]
