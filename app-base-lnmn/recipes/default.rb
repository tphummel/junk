#
# Cookbook Name:: app-base-lnmn
# Recipe:: default
#
# Copyright (C) 2013 Tom Hummel

include_recipe "apt"
include_recipe "build-essential"
include_recipe "git"

include_recipe "mongodb::10gen_repo"
include_recipe "mongodb"

include_recipe "nginx"

include_recipe "redisio::install"
include_recipe "redisio::enable"

include_recipe "nodejs::default"