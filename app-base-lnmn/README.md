# app-base-lnmn cookbook

app-base [Linux, Nginx, MongoDB, Node.js]

# Requirements

ubuntu 12.04 LTS tested

# Usage

### dev

install vagrant/virtualbox

    vagrant up

### production
    bundle 
    bundle exec knife solo bootstrap root@[ip] --bootstrap-version=10.26.0 --run-list="recipe[app-base-lnmn::default]"

### AWS w/ PIOPS

    - AWS dash: create instance with piops, add key
    - mount vol (attach and make available, 2 steps, 1 manual)
      connect via ssh
      sudo mkfs -t ext4 /dev/xvdd
      sudo mkdir /vol
      sudo mount /dev/xvdd /vol
      edit /etc/fstab: /dev/xvdc  /vol  auto  0 0

    - put key path in .chef/knife.rb
    - bundle exec knife solo...

# Attributes

overriding some stuff in attributes/default.rb:

    set['nodejs']['version'] = '0.8.25'
    set['mongodb'][:package_version] = "2.4.5"

# Upgrading

lookup shasum 256 for architecture and overwrite attribute for version

mongodb will be upgraded with sudo apt-get upgrade or by running knife-solo

# Recipes

### default
node.js 8.25, mongodb 2.4.5, redis stable, nginx stable

# Author

Author:: Tom Hummel (tphummel@gmail.com)
