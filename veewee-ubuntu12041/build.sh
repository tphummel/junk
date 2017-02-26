#!/bin/bash

bundle install

bundle exec veewee vbox build 'ubuntu12041' --force --auto --nogui
bundle exec veewee vbox validate 'ubuntu12041'
bundle exec vagrant basebox export 'ubuntu12041' --force