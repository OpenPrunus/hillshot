# Dépendances PHP (PSR-3, PSR-20) et autoloader PSR-4 optimisé : sans les outils de développement
FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
COPY src/ src/
RUN composer install --no-dev --no-interaction --no-progress --prefer-dist --classmap-authoritative --ignore-platform-reqs

FROM php:8.5-apache-trixie

# .htaccess de data/ (Require all denied) honoré
RUN a2enmod rewrite && \
    sed -ri 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

# data/ n'est jamais servi par le web, même si un bind-mount masque son .htaccess
RUN printf '<Directory /var/www/html/data>\n    Require all denied\n</Directory>\n' > /etc/apache2/conf-available/hillshot-data.conf && \
    a2enconf hillshot-data

# Site web (docroot) ; le serveur WebSocket, le code partagé (src/) et les dépendances sont HORS docroot : jamais servis par Apache
COPY web/ /var/www/html/
COPY server/ /opt/hillshot/
COPY src/ /opt/hillshot/src/
COPY --from=vendor /app/vendor/ /opt/hillshot/vendor/
ENV HILLSHOT_AUTOLOAD=/opt/hillshot/vendor/autoload.php
RUN mkdir -p /var/www/html/data && chown -R www-data:www-data /var/www/html/data

# Le serveur de jeu écrit le classement (ratings.json) dans le même dossier que le site le lit
ENV HILLSHOT_DATA_DIR=/var/www/html/data
VOLUME /var/www/html/data
EXPOSE 80 8081
