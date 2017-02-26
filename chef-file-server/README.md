chef-file-server
---

my chef scripts for setting up a file server on Ubuntu

Setup
---

get ruby, gems, chef, git

    sudo apt-get update

    sudo apt-get install -y -f -m  ruby1.9.1 ruby1.9.1-dev \
      rubygems1.9.1 \
      build-essential libopenssl-ruby1.9.1 libssl-dev zlib1g-dev

    sudo gem install chef --no-rdoc --no-ri

    sudo apt-get install -y -f -m git

clone this repo

    git clone https://github.com/tphummel/chef-file-server.git

put ```config/solo.rb``` and ```config/node.json``` into ```/etc/chef/```:

    cd {project_root}
    sudo mkdir /etc/chef
    sudo cp config/* /etc/chef

run it: 

    sudo chef-solo -c /etc/chef/solo.rb -j /etc/chef/node.json