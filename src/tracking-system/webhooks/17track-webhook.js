const express = require('express');
const logger = require('../utils/logger');
const { RedisStoreSync } = require('../utils/redis-store-sync');
const { TRACKING_CONFIG } = require('../config/settings');

const router = express.Router();
const redis = new RedisStoreSync();

// Middleware para verificar autenticidade do webhook
const verifyWebhook = (req, res, next) => {
    try {
        const signature = req.headers['17token'];
        const expectedToken = TRACKING_CONFIG.webhook.secret;

        if (!signature || signature !== expectedToken) {
            logger.warn('[17Track] Tentativa de acesso ao webhook com token inválido:', {
                ip: req.ip,
                token: signature ? 'presente mas inválido' : 'ausente',
                timestamp: new Date().toISOString()
            });
            return res.status(401).json({ error: 'Unauthorized' });
        }

        next();
    } catch (error) {
        logger.error('[17Track] Erro na verificação do webhook:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        return res.status(401).json({ error: 'Invalid signature' });
    }
};

// Endpoint para receber atualizações do 17track
router.post(TRACKING_CONFIG.paths.webhook, verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const updates = req.body.data;
        if (!updates || !Array.isArray(updates)) {
            logger.warn('[17Track] Payload inválido recebido:', {
                body: req.body,
                timestamp: new Date().toISOString()
            });
            return res.status(400).json({ error: 'Invalid payload' });
        }

        logger.info('[17Track] Recebidas atualizações:', {
            count: updates.length,
            timestamp: new Date().toISOString()
        });

        // Processa cada atualização
        for (const update of updates) {
            try {
                await processTrackingUpdate(update);
            } catch (error) {
                logger.error('[17Track] Erro ao processar atualização:', {
                    update,
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
            }
        }

        const processingTime = Date.now() - startTime;
        logger.info('[17Track] Processamento concluído:', {
            count: updates.length,
            processingTime,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({ 
            message: 'Updates processed',
            count: updates.length,
            processingTime 
        });
    } catch (error) {
        logger.error('[17Track] Erro geral no webhook:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Processa uma atualização de rastreamento
 * @param {Object} update - Dados da atualização
 * @returns {Promise<void>}
 */
async function processTrackingUpdate(update) {
    try {
        // Valida dados da atualização
        if (!update.number || !update.status) {
            logger.warn('[17Track] Atualização inválida:', {
                update,
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Salva atualização no Redis
        const trackingKey = `${TRACKING_CONFIG.cache.prefix}tracking:${update.number}`;
        const trackingData = {
            status: update.status,
            lastUpdate: new Date().toISOString(),
            events: update.events || [],
            meta: {
                source: '17track',
                webhookReceived: true
            }
        };

        await redis.set(trackingKey, JSON.stringify(trackingData), TRACKING_CONFIG.cache.ttl.tracking);

        // Verifica se precisa notificar
        if (shouldNotifyUpdate(update)) {
            const notification = formatTrackingNotification(update);
            await sendTrackingNotification(notification);
        }

        logger.info('[17Track] Atualização processada:', {
            trackingNumber: update.number,
            status: update.status,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('[17Track] Erro ao processar atualização:', {
            trackingNumber: update.number,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

/**
 * Verifica se deve notificar sobre a atualização
 * @param {Object} update - Dados da atualização
 * @returns {boolean}
 */
function shouldNotifyUpdate(update) {
    const notifiableStatus = [
        'delivered',
        'out_for_delivery',
        'exception',
        'returned'
    ];

    return notifiableStatus.includes(update.status.toLowerCase());
}

/**
 * Formata mensagem de notificação de rastreamento
 * @param {Object} update - Dados da atualização
 * @returns {string}
 */
function formatTrackingNotification(update) {
    return `Atualização de rastreamento: ${update.number} - ${update.status}`;
}

/**
 * Envia notificação de rastreamento
 * @param {string} message - Mensagem de notificação
 * @returns {Promise<void>}
 */
async function sendTrackingNotification(message) {
    // Implementar integração com WhatsApp
    logger.info('[17Track] Mensagem para enviar:', message);
}

module.exports = router;
