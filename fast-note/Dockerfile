FROM php:8.3-apache
WORKDIR /var/www/html
COPY . /var/www/html
RUN chown -R www-data:www-data /var/www/html
RUN sed -i 's/Listen 80/Listen 8080/' /etc/apache2/ports.conf
RUN sed -i 's/:80>/:8080>/' /etc/apache2/sites-available/000-default.conf
# Create data directory for SQLite database
RUN mkdir -p /var/www/html/data && chown www-data:www-data /var/www/html/data
ENV FASTNOTE_DB=/var/www/html/data/notes.sqlite
EXPOSE 8080
