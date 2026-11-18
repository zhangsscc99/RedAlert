module.exports = {
  apps: [{
    name: 'redalert',
    script: 'server/index.js',
    cwd: '/root/work/RedAlert',
    node_args: [],
    instances: 1,
    autorestart: true,
    max_restarts: 100,
    min_uptime: '10s',
    restart_delay: 2000,
    max_memory_restart: '1G',
    env: { NODE_ENV: 'production', PORT: '3027' },
    out_file: '/root/work/RedAlert/data/out.log',
    error_file: '/root/work/RedAlert/data/err.log',
    merge_logs: true,
    time: true
  }]
};
