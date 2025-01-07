const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { RedisStore } = require('../utils/redis-store');
const logger = require('../utils/logger');

const redis = new RedisStore();

// Middleware para verificar autenticidade do webhook
const verifyWebhook = (req, res, next) => {
    try {
        const signature = req.headers['17token'];
        const expectedToken = process.env.TRACK17_API_KEY;

        if (!signature || signature !== expectedToken) {
            logger.warn('Tentativa de acesso ao webhook com token inválido:', {
                ip: req.ip,
                token: signature ? 'presente mas inválido' : 'ausente'
            });
            return res.status(401).json({ error: 'Unauthorized' });
        }

        next();
    } catch (error) {
        logger.error('Erro na verificação do webhook:', error);
        return res.status(401).json({ error: 'Invalid signature' });
    }
};

// Endpoint para receber atualizações do 17track
router.post('/push', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const updates = req.body.data;
        if (!updates || !Array.isArray(updates)) {
            logger.warn('Payload inválido recebido:', req.body);
            return res.status(400).json({ error: 'Invalid payload' });
        }

        logger.info(`Recebidas ${updates.length} atualizações do 17track`);

        let successCount = 0;
        let errorCount = 0;

        for (const update of updates) {
            try {
                const trackingData = {
                    code: update.number,
                    carrier: update.carrier || 'Desconhecido',
                    status: {
                        text: update.track_info?.latest_status?.status || 'Desconhecido',
                        location: update.track_info?.latest_status?.location || 'N/A',
                        time: update.track_info?.latest_status?.time
                    },
                    events: update.track_info?.events || [],
                    lastUpdate: new Date().toISOString(),
                    meta: {
                        webhookReceived: true,
                        updateTimestamp: startTime
                    }
                };

                // Busca dados existentes para preservar informações importantes
                const existingData = await redis.getTrackingCode(update.number);
                if (existingData) {
                    trackingData.orderId = existingData.orderId;
                    trackingData.customerName = existingData.customerName;
                    trackingData.shippingAddress = existingData.shippingAddress;
                }

                // Salva atualização no Redis
                await redis.saveTrackingCode(update.number, trackingData);
                successCount++;

                logger.info(`Atualização processada para código ${update.number}:`, {
                    status: trackingData.status.text,
                    location: trackingData.status.location
                });
            } catch (error) {
                errorCount++;
                logger.error(`Erro ao processar atualização para código ${update.number}:`, error);
            }
        }

        const processingTime = Date.now() - startTime;
        logger.info('Processamento de webhook concluído:', {
            total: updates.length,
            success: successCount,
            errors: errorCount,
            processingTime: `${processingTime}ms`
        });

        return res.status(200).json({
            message: 'Updates processed',
            stats: {
                total: updates.length,
                success: successCount,
                errors: errorCount,
                processingTime
            }
        });
    } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error('Erro ao processar webhook:', {
            error: error.message,
            stack: error.stack,
            processingTime
        });
        
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;
