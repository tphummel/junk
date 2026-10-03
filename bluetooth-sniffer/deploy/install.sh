#!/bin/sh
# Usage: sudo ./install.sh /path/to/bluetooth-sniffer-linux-amd64
set -eu
bin=${1:?path to binary}
id btscanner >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin btscanner
usermod -aG bluetooth btscanner
install -d -o btscanner -g btscanner -m 0750 /opt/bluetooth-sniffer
install -m 0755 "$bin" /usr/local/bin/bluetooth-sniffer
install -m 0644 "$(dirname "$0")/bluetooth-sniffer.service" /etc/systemd/system/
install -m 0644 "$(dirname "$0")/bluetooth-sniffer.cron" /etc/cron.d/bluetooth-sniffer
systemctl daemon-reload
echo "edit -adapter in the unit if needed, then: systemctl enable --now bluetooth bluetooth-sniffer"
