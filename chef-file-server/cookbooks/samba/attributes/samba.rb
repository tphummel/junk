default[:samba]                     = {}
default[:samba][:workgroup]         = "MARINERSVILLAGE"
default[:samba][:security_level]    = "user"

default[:samba][:share] = {}
default[:samba][:share][:name] = "file_share"
default[:samba][:share][:comment] = "Ubuntu File Server Share"
default[:samba][:share][:path] = "/srv/share"
default[:samba][:share][:browseable] = "yes"
default[:samba][:share][:guest_ok] = "yes"
default[:samba][:share][:read_only] = "no"
default[:samba][:share][:create_mask] = "0755"