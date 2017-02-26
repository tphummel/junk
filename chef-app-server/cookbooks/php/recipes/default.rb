packages = ["php5-cgi", "php5-cli", "php5-mysql", "php5-curl", "php5-gd",
  "php5-idn", "php-pear", "php5-imagick", "php5-imap", "php5-mcrypt",
  "php5-memcache", "php5-mhash", "php5-pspell", "php5-recode", "php5-sqlite",
  "php5-tidy", "php5-xmlrpc", "php5-xsl"
]

packages.each do |pkg|
  package pkg
end

template "php-fastcgi upstart" do
  source "php-fastcgi-upstart.erb"
  path "/etc/init.d/php-fastcgi"
  owner "root"
  group "root"
  mode "0755"
  notifies :restart, "service[php-fastcgi]"
end

service "php-fastcgi" do
  action [:enable, :start]
end
  