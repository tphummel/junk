FROM php:8.3-apache
WORKDIR /var/www/html
COPY . /var/www/html
RUN chown -R www-data:www-data /var/www/html
RUN sed -i 's/Listen 80/Listen 8080/' /etc/apache2/ports.conf
RUN sed -i 's/:80>/:8080>/' /etc/apache2/sites-available/000-default.conf
EXPOSE 8080
