directory "/vol/log/nginx" do
  owner "root"
  group "root"
  mode "0755"
  recursive true
end

package "nginx"

service 'nginx' do
  supports :status => true, :restart => true, :reload => true
  action :enable
end

template "nginx.conf" do
  path "/etc/nginx/nginx.conf"
  source "nginx.conf.erb"
  owner "root"
  group "root"
  mode "0644"
  notifies :reload, 'service[nginx]', :immediately
end

service "nginx" do
  action [:enable, :start]
end