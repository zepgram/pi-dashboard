// Known services by port with check type and icon
// Shared between index.js and stats.js

export const KNOWN_SERVICES = {
  21:    { name: 'FTP', icon: 'folder', checkType: 'tcp' },
  22:    { name: 'SSH', icon: 'terminal', checkType: 'tcp' },
  25:    { name: 'SMTP', icon: 'mail', checkType: 'tcp' },
  53:    { name: 'DNS', icon: 'globe', checkType: 'dns' },
  80:    { name: 'HTTP', icon: 'globe', checkType: 'http', path: '/' },
  81:    { name: 'Nginx Proxy Manager', icon: 'server', checkType: 'http', path: '/' },
  110:   { name: 'POP3', icon: 'mail', checkType: 'tcp' },
  111:   { name: 'RPC', icon: 'cpu', checkType: 'tcp' },
  143:   { name: 'IMAP', icon: 'mail', checkType: 'tcp' },
  443:   { name: 'HTTPS', icon: 'lock', checkType: 'http', path: '/' },
  500:   { name: 'IKEv2/IPSec', icon: 'shield', checkType: 'interface', interface: 'ipsec0' },
  631:   { name: 'CUPS', icon: 'printer', checkType: 'http', path: '/' },
  1194:  { name: 'OpenVPN', icon: 'shield', checkType: 'interface', interface: 'tun0' },
  1723:  { name: 'PPTP', icon: 'shield', checkType: 'tcp' },
  1883:  { name: 'MQTT', icon: 'radio', checkType: 'tcp' },
  2049:  { name: 'NFS', icon: 'hard-drive', checkType: 'tcp' },
  3000:  { name: 'Grafana', icon: 'bar-chart', checkType: 'http', path: '/api/health' },
  3001:  { name: 'Pi Dashboard', icon: 'activity', checkType: 'http', path: '/api/health' },
  3306:  { name: 'MySQL', icon: 'database', checkType: 'tcp' },
  4500:  { name: 'IPSec NAT-T', icon: 'shield', checkType: 'interface', interface: 'ipsec0' },
  5432:  { name: 'PostgreSQL', icon: 'database', checkType: 'tcp' },
  5900:  { name: 'VNC', icon: 'monitor', checkType: 'tcp' },
  5984:  { name: 'CouchDB', icon: 'database', checkType: 'http' },
  6379:  { name: 'Redis', icon: 'database', checkType: 'redis' },
  6881:  { name: 'BitTorrent', icon: 'download', checkType: 'tcp' },
  7474:  { name: 'Neo4j', icon: 'database', checkType: 'http' },
  7681:  { name: 'ttyd', icon: 'terminal', checkType: 'http', path: '/' },
  8080:  { name: 'HTTP Proxy', icon: 'globe', checkType: 'http', path: '/' },
  8086:  { name: 'InfluxDB', icon: 'database', checkType: 'http' },
  8096:  { name: 'Jellyfin', icon: 'film', checkType: 'http', path: '/' },
  8112:  { name: 'Deluge', icon: 'download', checkType: 'http', path: '/' },
  8123:  { name: 'Home Assistant', icon: 'home', checkType: 'http', path: '/' },
  8384:  { name: 'Syncthing', icon: 'refresh-cw', checkType: 'http', path: '/' },
  8443:  { name: 'HTTPS Alt', icon: 'lock', checkType: 'http', path: '/' },
  8686:  { name: 'Lidarr', icon: 'music', checkType: 'http', path: '/' },
  8787:  { name: 'Readarr', icon: 'book', checkType: 'http', path: '/' },
  8989:  { name: 'Sonarr', icon: 'tv', checkType: 'http', path: '/' },
  9000:  { name: 'Portainer', icon: 'box', checkType: 'http', path: '/' },
  9042:  { name: 'Cassandra', icon: 'database', checkType: 'tcp' },
  9090:  { name: 'Prometheus', icon: 'bar-chart', checkType: 'http', path: '/-/healthy' },
  9091:  { name: 'Transmission', icon: 'download', checkType: 'http', path: '/' },
  9117:  { name: 'Jackett', icon: 'search', checkType: 'http', path: '/' },
  9200:  { name: 'Elasticsearch', icon: 'database', checkType: 'http' },
  9696:  { name: 'Prowlarr', icon: 'search', checkType: 'http', path: '/' },
  10000: { name: 'Webmin', icon: 'settings', checkType: 'http', path: '/' },
  11434: { name: 'Ollama', icon: 'cpu', checkType: 'http', path: '/' },
  19999: { name: 'Netdata', icon: 'activity', checkType: 'http', path: '/' },
  26257: { name: 'CockroachDB', icon: 'database', checkType: 'tcp' },
  27017: { name: 'MongoDB', icon: 'database', checkType: 'tcp' },
  28015: { name: 'RethinkDB', icon: 'database', checkType: 'tcp' },
  32400: { name: 'Plex', icon: 'play-circle', checkType: 'http', path: '/web' },
  51413: { name: 'Transmission P2P', icon: 'download', checkType: 'tcp' },
  51820: { name: 'WireGuard', icon: 'shield', checkType: 'interface', interface: 'wg0' },
  58846: { name: 'Deluge Daemon', icon: 'download', checkType: 'tcp' },
};

// Known process names to service mapping
export const KNOWN_PROCESSES = {
  'nginx': { name: 'Nginx', icon: 'server', checkType: 'http', path: '/' },
  'apache2': { name: 'Apache', icon: 'server', checkType: 'http', path: '/' },
  'httpd': { name: 'Apache', icon: 'server', checkType: 'http', path: '/' },
  'pihole-FTL': { name: 'Pi-hole', icon: 'shield', checkType: 'http', path: '/admin/' },
  'grafana': { name: 'Grafana', icon: 'bar-chart', checkType: 'http', path: '/api/health' },
  'prometheus': { name: 'Prometheus', icon: 'bar-chart', checkType: 'http', path: '/-/healthy' },
  'node': { name: 'Node.js', icon: 'hexagon', checkType: 'http', path: '/' },
  'java': { name: 'Java App', icon: 'coffee', checkType: 'http', path: '/' },
  'python': { name: 'Python App', icon: 'code', checkType: 'http', path: '/' },
  'deluged': { name: 'Deluge', icon: 'download', checkType: 'http', path: '/' },
  'transmission': { name: 'Transmission', icon: 'download', checkType: 'http', path: '/' },
  'jellyfin': { name: 'Jellyfin', icon: 'film', checkType: 'http', path: '/' },
  'plex': { name: 'Plex', icon: 'play-circle', checkType: 'http', path: '/web' },
  'homeassistant': { name: 'Home Assistant', icon: 'home', checkType: 'http', path: '/' },
  'ollama': { name: 'Ollama', icon: 'cpu', checkType: 'http', path: '/' },
  'redis-server': { name: 'Redis', icon: 'database', checkType: 'redis' },
  'mariadbd': { name: 'MariaDB', icon: 'database', checkType: 'tcp' },
  'mysqld': { name: 'MySQL', icon: 'database', checkType: 'tcp' },
  'postgres': { name: 'PostgreSQL', icon: 'database', checkType: 'tcp' },
  'mongod': { name: 'MongoDB', icon: 'database', checkType: 'tcp' },
  'sshd': { name: 'SSH', icon: 'terminal', checkType: 'tcp' },
  'unbound': { name: 'Unbound DNS', icon: 'globe', checkType: 'dns' },
};

export const VALID_CHECK_TYPES = ['http', 'tcp', 'redis', 'dns', 'interface'];

// Infer checkType from port if not explicitly set
export function inferCheckType(port, explicitCheckType) {
  if (explicitCheckType && VALID_CHECK_TYPES.includes(explicitCheckType)) {
    return explicitCheckType;
  }
  if (KNOWN_SERVICES[port]) {
    return KNOWN_SERVICES[port].checkType;
  }
  return 'tcp';
}

// Infer icon from port if not explicitly set
export function inferIcon(port, explicitIcon) {
  if (explicitIcon && explicitIcon !== 'server') {
    return explicitIcon;
  }
  if (KNOWN_SERVICES[port]) {
    return KNOWN_SERVICES[port].icon;
  }
  return 'server';
}
