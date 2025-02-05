const axios = require('axios');
const logger = require('../utils/logger');
const { RedisStoreSync } = require('../utils/redis-store-sync');
const { TRACKING_CONFIG } = require('../../../config/settings');

class Track17PushService {
    constructor() {
        this.redis = new RedisStoreSync();
        this.config = TRACKING_CONFIG;

        // Cliente HTTP
        this.client = axios.create({
            baseURL: this.config.endpoint,
            timeout: 30000,
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Solicita atualizações de rastreamento
     * @param {string[]} trackingNumbers - Lista de códigos de rastreio
     * @returns {Promise<Object>} Resultado da solicitação
     */
    async requestUpdates(trackingNumbers) {
        if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
            logger.warn('[17Track] Nenhum código de rastreio para solicitar atualizações');
            return { success: false, message: 'No tracking numbers provided' };
        }

        // Valida limite de códigos
        if (trackingNumbers.length > this.config.limits.maxTrackingNumbers) {
            logger.warn('[17Track] Limite de códigos excedido:', {
                provided: trackingNumbers.length,
                limit: this.config.limits.maxTrackingNumbers
            });
            return { 
                success: false, 
                message: `Maximum of ${this.config.limits.maxTrackingNumbers} tracking numbers allowed`
            };
        }

        try {
            // Verifica rate limit
            const lastRequest = await this.redis.get(`${this.config.cache.prefix}last_push_request`);
            if (lastRequest) {
                const timeSinceLastRequest = Date.now() - new Date(lastRequest).getTime();
                if (timeSinceLastRequest < 60000) { // 1 minuto
                    logger.warn('[17Track] Rate limit do push:', {
                        lastRequest,
                        waitTime: Math.ceil((60000 - timeSinceLastRequest) / 1000)
                    });
                    return {
                        success: false,
                        message: 'Rate limit exceeded, try again later'
                    };
                }
            }

            const payload = {
                numbers: trackingNumbers.map(number => ({
                    number: number,
                    auto_detection: true,
                    carrier: this._detectCarrier(number)
                }))
            };

            logger.info('[17Track] Solicitando atualizações:', {
                count: trackingNumbers.length,
                path: this.config.paths.push
            });

            const response = await this.client.post(this.config.paths.push, payload);

            // Processa resposta
            const result = this._processResponse(response.data);

            // Atualiza timestamp da última solicitação
            await this.redis.set(
                `${this.config.cache.prefix}last_push_request`,
                new Date().toISOString(),
                this.config.cache.ttl.push
            );

            // Cache dos resultados
            await this._cacheResults(result);

            logger.info('[17Track] Solicitação processada:', {
                total: trackingNumbers.length,
                accepted: result.accepted.length,
                rejected: result.rejected.length
            });

            return {
                success: true,
                ...result
            };
        } catch (error) {
            logger.error('[17Track] Erro ao solicitar atualizações:', {
                error: error.message,
                trackingNumbers,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Processa atualizações de rastreamento
     * @param {Array} updates - Lista de atualizações
     * @returns {Promise<void>}
     */
    async processUpdates(updates) {
        if (!Array.isArray(updates) || updates.length === 0) {
            logger.warn('[17Track] Nenhuma atualização para processar');
            return;
        }

        logger.info('[17Track] Processando atualizações:', {
            quantidade: updates.length,
            timestamp: new Date().toISOString()
        });

        for (const update of updates) {
            try {
                // Valida dados da atualização
                if (!update.number || !update.status) {
                    continue;
                }

                // Salva atualização no Redis
                const key = `${this.config.cache.prefix}tracking:${update.number}`;
                await this.redis.set(key, {
                    status: update.status,
                    lastUpdate: new Date().toISOString(),
                    events: update.events || []
                }, this.config.cache.ttl.tracking);

                // Prepara notificação
                if (this._shouldNotify(update)) {
                    await this._sendNotification(update);
                }

            } catch (error) {
                logger.error('[17Track] Erro ao processar atualização:', {
                    trackingNumber: update.number,
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    /**
     * Verifica se deve enviar notificação
     * @private
     * @param {Object} update - Dados da atualização
     * @returns {boolean}
     */
    _shouldNotify(update) {
        // Status importantes que devem gerar notificação
        const notifiableStatus = [
            'delivered',
            'out_for_delivery',
            'exception',
            'returned'
        ];

        return notifiableStatus.includes(update.status.toLowerCase());
    }

    /**
     * Envia notificação de atualização
     * @private
     * @param {Object} update - Dados da atualização
     * @returns {Promise<void>}
     */
    async _sendNotification(update) {
        try {
            const message = this._formatNotificationMessage(update);
            await this._sendWhatsAppNotification(message);
        } catch (error) {
            logger.error('[17Track] Erro ao enviar notificação:', {
                trackingNumber: update.number,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Formata mensagem de notificação
     * @private
     * @param {Object} update - Dados da atualização
     * @returns {string}
     */
    _formatNotificationMessage(update) {
        const statusEmojis = {
            'delivered': '✅',
            'out_for_delivery': '🚗',
            'exception': '❌',
            'returned': '↩️'
        };

        const emoji = statusEmojis[update.status.toLowerCase()] || '📦';
        return `${emoji} Atualização de Rastreio\n\n` +
               `Código: ${update.number}\n` +
               `Status: ${update.status}\n` +
               `Data: ${new Date().toLocaleString('pt-BR')}\n\n` +
               `${update.events?.[0]?.description || 'Sem detalhes disponíveis'}`;
    }

    /**
     * Envia notificação via WhatsApp
     * @private
     * @param {string} message - Mensagem a ser enviada
     * @returns {Promise<void>}
     */
    async _sendWhatsAppNotification(message) {
        // Implementar integração com WhatsAppService
        logger.info('[17Track] Notificação preparada:', {
            message,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Processa resposta da API
     * @private
     */
    _processResponse(response) {
        const result = {
            accepted: [],
            rejected: [],
            messages: []
        };

        if (response.ret !== 0) {
            result.messages.push(response.msg || 'Unknown error');
            return result;
        }

        if (response.data?.accepted) {
            result.accepted = response.data.accepted.map(item => ({
                code: item.number,
                carrier: item.carrier,
                status: this._normalizeStatus(item.status)
            }));
        }

        if (response.data?.rejected) {
            result.rejected = response.data.rejected.map(item => ({
                code: item.number,
                reason: item.error || 'Unknown reason'
            }));
        }

        return result;
    }

    /**
     * Salva resultados no cache
     * @private
     */
    async _cacheResults(result) {
        const timestamp = new Date().toISOString();

        // Cache dos aceitos
        for (const item of result.accepted) {
            const key = `${this.config.cache.prefix}${item.code}`;
            await this.redis.set(key, JSON.stringify({
                ...item,
                lastUpdate: timestamp,
                meta: {
                    source: '17track_push',
                    timestamp
                }
            }), this.config.cache.ttl.push);
        }

        // Cache dos rejeitados
        for (const item of result.rejected) {
            const key = `${this.config.cache.prefix}${item.code}_rejected`;
            await this.redis.set(key, JSON.stringify({
                ...item,
                timestamp,
                meta: {
                    source: '17track_push',
                    timestamp
                }
            }), this.config.cache.ttl.push);
        }
    }

    /**
     * Detecta transportadora pelo código
     * @private
     */
    _detectCarrier(code) {
        // Por enquanto retorna correios como padrão
        return 'correios';
    }

    /**
     * Normaliza status do rastreio
     * @private
     */
    _normalizeStatus(status) {
        const statusMap = {
            'pending': 'pendente',
            'in_transit': 'em_transito',
            'delivered': 'entregue',
            'exception': 'problema',
            'expired': 'expirado',
            'returning': 'retornando'
        };

        return statusMap[status] || status;
    }
}

module.exports = { Track17PushService };
