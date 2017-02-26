name             "app-base-lemp"
maintainer       "Tom Hummel"
maintainer_email "tphummel@gmail.com"
license          "MIT"
description      "Installs/Configures a basic LEMP server"
long_description IO.read(File.join(File.dirname(__FILE__), 'README.md'))
version          "0.0.0"

depends "apt"
depends "build-essential"
depends "git"
depends "mariadb"
depends "nginx"