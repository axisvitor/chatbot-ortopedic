module.exports = {
  apps: [
    {
      name: 'chatbot',
      script: 'src/server.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
      }
    },
    {
      name: 'tracking-webhook',
      script: 'src/tracking-system/app.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
      }
    },
    {
      name: 'tracking-sync',
      script: 'src/tracking-system/sync_tracking_codes.js',
      cron_restart: '0 0 * * *', // Executa todo dia à meia-noite
      watch: false,
      autorestart: false,
      env: {
        NODE_ENV: 'production',
      }
    },
    {
      name: '17track-sync',
      script: 'src/tracking-system/sync_17track.js',
      cron_restart: '*/30 * * * *', // Executa a cada 30 minutos
      watch: false,
      autorestart: false,
      env: {
        NODE_ENV: 'production',
      }
    }
  ]
};
