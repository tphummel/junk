set['nodejs']['version'] = '0.10.20'
# update the checksum from the default (for 0.10.20) (http://nodejs.org/dist/v0.10./SHASUMS256.txt)
set['nodejs']['checksum_linux_x64'] = "eaebfc66d031f3b5071b72c84dd74f326a9a3c018e14d5de7d107c4f3a36dc96"
set['nodejs']['install_method'] = 'binary'


set['mongodb'][:package_version] = "2.4.6"
# set['mongodb'][:dbpath] = "/vol/lib/mongodb"
# set['nginx']['dir'] = "/opt/nginx"