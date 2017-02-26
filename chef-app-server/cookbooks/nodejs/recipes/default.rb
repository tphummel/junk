execute "update sources" do
  command "sudo apt-get -y -f -m update"
  action :run
end

package "python-software-properties" do
  notifies :run, resources(:execute => "update sources"), :immediately
end

execute "add latest nodejs ppa" do
  command "sudo add-apt-repository ppa:chris-lea/node.js"
  action :run
  notifies :run, resources(:execute => "update sources"), :immediately
  not_if  "ls /etc/apt/sources.list.d/chris-lea*"
end

package "nodejs"
package "npm"