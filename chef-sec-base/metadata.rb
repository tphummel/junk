name             "sec-base"
maintainer       "Tom Hummel"
maintainer_email "tphummel@gmail.com"
license          "MIT"
description      "Installs/Configures a securty baseline"
long_description IO.read(File.join(File.dirname(__FILE__), 'README.md'))
version          "0.1.0"

depends 'apt'
depends 'build-essential'
depends 'git'
depends 'fail2ban'
depends 'logwatch'
depends 'firewall'