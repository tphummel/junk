# app-base-lemp cookbook

app-base [Linux, EngineX, MariaDB, PHP]

# Requirements

ubuntu 12.04 LTS tested

# Usage

### dev

install vagrant/virtualbox

    vagrant up

### production

#### knife-solo

    bundle 
    bundle exec knife solo bootstrap root@[ip] \
    --bootstrap-version=10.26.0 \
      --run-list="recipe[app-base-lemp::default]"

#### knife-digital_ocean (w/ knife-solo)

    bundle 
    set your api info in .chef/knife.rb
    bundle exec knife digital_ocean droplet create --server-name giambi \
      --image 284203 \
      --location 3 \
      --size 66 \
      --ssh-keys 22117 \
      --solo --bootstrap-version=10.26.0 --run-list="recipe[app-base-lemp::default]"

# Attributes

overriding some stuff in attributes/default.rb:

    set['mariadb']['version'] = "5.5"

# Recipes

### default
php5, mariadb 5.5, nginx stable

# Author

Author:: Tom Hummel (tphummel@gmail.com)
