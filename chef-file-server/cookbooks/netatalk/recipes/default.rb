directory "create filesharing directory" do
  path "/srv/share"
  owner "nobody"
  group "nogroup"
  mode "0775"
  recursive true
end

package "netatalk"

template "/etc/netatalk/afpd.conf" do
  source "netatalk-afpd.conf.erb"
  owner  "root"
  group  "root"
  mode   "0755"
end

template "etc/default/netatalk" do
  source "default-netatalk.erb"
  owner "root"
  group "root"
  mode "0755"
end

template "etc/netatalk/AppleVolumes.default" do
  source "AppleVolumes.default.erb"
  owner "root"
  group "root"
  mode "0755"
end

service "netatalk" do
  action [:enable, :restart]
end



package "avahi-daemon" 

template "/etc/avahi/services/afpd.conf" do
  source "avahi-afpd.conf.erb"
  owner "root"
  group "root"
  mode "0755"
end

service "avahi-daemon" do
  action [:enable, :restart]
end

# update-rc.d -f avahi-daemon defaults
# update-rc.d -f netatalk defaults
