#! /bin/sh

sudo apt-get update

sudo apt-get install -y -f -m  ruby1.9.1 ruby1.9.1-dev \
  rubygems1.9.1 \
  build-essential libopenssl-ruby1.9.1 libssl-dev zlib1g-dev

sudo gem install chef --no-rdoc --no-ri

sudo apt-get install -y -f -m git

git clone git@git.lincx.me:apps/mongodb-chef.git