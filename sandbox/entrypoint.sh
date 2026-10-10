#!/bin/sh
set -eu
# Outbound package downloads are allowed. Private networks, the host, metadata
# endpoints and other workspace containers are not reachable from commands.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -d 10.0.0.0/8 -j REJECT
iptables -A OUTPUT -d 172.16.0.0/12 -j REJECT
iptables -A OUTPUT -d 192.168.0.0/16 -j REJECT
iptables -A OUTPUT -d 169.254.0.0/16 -j REJECT
iptables -A OUTPUT -d 100.64.0.0/10 -j REJECT
# Replies to the host-published gateway are permitted, but new connections are not.
iptables -I OUTPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
mkdir -p /state/home
chown -R 1000:1000 /state
exec setpriv --reuid=1000 --regid=1000 --init-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /opt/zini/node_modules/.bin/tsx /opt/zini/sandbox/gateway.ts
