package "samba"

template "put samba config file" do
  source "samba.conf.erb"
  path "/etc/samba/smb.conf"
  owner  "root"
  group  "root"
  mode   "0755"
end

directory "create filesharing directory" do
  path "/srv/share"
  owner "nobody"
  group "nogroup"
  mode "0775"
  recursive true
end

service "windows support daemon" do
  service_name "smbd"
  action [:enable, :restart]
end 

service "NetBIOS name server daemon" do
  service_name "nmbd"
  action [:enable, :restart]
end