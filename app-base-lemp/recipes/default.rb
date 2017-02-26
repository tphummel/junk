#
# Cookbook Name:: app-base-lemp
# Recipe:: default
#
# Copyright (C) 2013 Tom Hummel

include_recipe "apt"
include_recipe "build-essential"
include_recipe "git"

include_recipe "nginx"
include_recipe "mariadb::server"
include_recipe "mariadb::client"

package "php5-fpm"
package "php5-mysql"

include_recipe "redisio::install"
include_recipe "redisio::enable"