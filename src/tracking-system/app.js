require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const logger = require('./utils/logger');
const nuvemshopWebhook = require('./webhooks/nuvemshop-webhook');
const { Scheduler } = require('./scheduler');
const { RedisStoreSync } = require('./utils/redis-store-sync');
const { REDIS_CONFIG } = require('../config/settings');

const app = express();
const port = process.env.PORT || 3000;
const scheduler = new Scheduler();

// Middleware para processar JSON
app.use(express.json());

// Rota para webhooks da Nuvemshop
app.use('/webhooks/nuvemshop', nuvemshopWebhook);

// Rota de healthcheck melhorada
app.get('/health', async (req, res) => {
    try {
        const redis = new RedisStoreSync();
        const redisStatus = await redis.checkConnection();
        
        const lastNuvemshopSync = await redis.get('last_nuvemshop_sync') || 'Nunca';
        const lastTrack17Sync = await redis.get('last_track17_sync') || 'Nunca';
        
        res.status(200).json({
            status: 'ok',
            redis: redisStatus,
            lastSync: {
                nuvemshop: lastNuvemshopSync,
                track17: lastTrack17Sync
            }
        });
    } catch (error) {
        logger.error('Erro no healthcheck:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Inicia o servidor
app.listen(port, async () => {
    logger.info(`Servidor rodando na porta ${port}`);
    
    // Inicia o scheduler
    try {
        await scheduler.start();
        logger.info('Scheduler iniciado com sucesso');
    } catch (error) {
        logger.error('Erro ao iniciar scheduler:', error);
    }
});

// Tratamento de shutdown gracioso
process.on('SIGTERM', () => {
    logger.info('Recebido sinal SIGTERM, iniciando shutdown...');
    scheduler.stop();
    process.exit(0);
});
