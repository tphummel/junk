cookbook_path ["cookbooks", "site-cookbooks"]
node_path     "nodes"
role_path     "roles"
data_bag_path "data_bags"
file_cache_path "/tmp/chef"
client_key "~/.ssh/id_rsa.pub"
#encrypted_data_bag_secret "data_bag_key"

knife[:berkshelf_path] = "cookbooks"
