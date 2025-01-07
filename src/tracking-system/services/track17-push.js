const axios = require('axios');
const logger = require('../utils/logger');
const { RedisStore } = require('../utils/redis-store');

class Track17PushService {
    constructor() {
        this.redis = new RedisStore();
        this.apiKey = process.env.TRACK17_API_KEY;
        this.pushUrl = 'https://api.17track.net/track/v2.2/push';
    }

    async requestUpdates(trackingNumbers) {
        if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
            logger.warn('Nenhum código de rastreio para solicitar atualizações');
            return;
        }

        try {
            const payload = {
                numbers: trackingNumbers.map(number => ({
                    number: number,
                    auto_detection: true
                }))
            };

            const response = await axios.post(this.pushUrl, payload, {
                headers: {
                    '17token': this.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            logger.info('Solicitação de atualizações enviada com sucesso', {
                total: trackingNumbers.length,
                response: response.data
            });

            // Atualiza timestamp da última solicitação
            await this.redis.set('last_17track_push_request', new Date().toISOString());

            return response.data;
        } catch (error) {
            logger.error('Erro ao solicitar atualizações do 17track:', {
                error: error.message,
                trackingNumbers
            });
            throw error;
        }
    }
}

module.exports = { Track17PushService };
