name "file_server_only"
description "a file sharing directory"
run_list(
  "recipe[samba]"
)