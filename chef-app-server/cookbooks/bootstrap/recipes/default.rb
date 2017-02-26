# mount ebs volume, using aws cookbook, if production
execute "update sources" do
  command "sudo apt-get -y -f -m update"
  action :run
end

directory "/vol/log" do
  action :create
  owner "root"
  group "root"
  mode "0755"
  recursive true
end

directory "/tmp" do
  action :create
  mode "0777"
  owner "root"
  group "root"
end

user "apps" do
  action :create
  home "/home/apps"
end

["/home/apps", "/home/apps/.ssh"].each do |dir|
  directory "#{dir}" do
    mode "0755"
    owner "apps"
    group "apps"
    recursive true
  end
end

template "/home/apps/.ssh/authorized_keys" do
  source "authorized_keys.erb"
  owner "apps"
  group "apps"
  mode "0600"
end