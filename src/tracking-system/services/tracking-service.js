const axios = require('axios');
const { logger } = require('../utils/logger');

class TrackingService {
    constructor() {
        this.config = {
            apiKey: process.env.TRACK17_API_KEY,
            endpoint: 'api.17track.net',
            registerPath: '/track/v2.2/register'
        };

        this.client = axios.create({
            baseURL: `https://${this.config.endpoint}`,
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Códigos das transportadoras no 17track (confirmados em teste)
        this.carriers = {
            jadlog: 21051,  // Confirmado
            correios: 2151  // Confirmado
        };

        // Padrões de rastreio por transportadora
        this.trackingPatterns = {
            jadlog: /^JD/i,
            correios: /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/
        };
    }

    async registerTrackingNumbers(orders) {
        try {
            // Prepara os números em lotes de 40 (limite da API)
            const batches = this._createBatches(orders, 40);
            let totalAccepted = 0;
            let totalRejected = 0;

            for (const batch of batches) {
                const tracks = batch.map(order => {
                    // Detecta carrier apenas para Jadlog e Correios
                    const carrier = this.detectCarrier(order.shipping_tracking);
                    
                    return {
                        number: order.shipping_tracking,
                        carrier, // Se null, o 17track fará a detecção automática
                        order_no: order.number.toString(),
                        order_time: new Date(order.created_at).toLocaleDateString('en-US'),
                        tag: order.id.toString()
                        // Não precisa especificar auto_detection, é true por padrão
                    };
                });

                const response = await this.client.post(this.config.registerPath, tracks);

                if (response.data.code === 0) {
                    totalAccepted += response.data.data.accepted.length;
                    totalRejected += response.data.data.rejected.length;

                    // Log detalhes dos aceitos e rejeitados
                    response.data.data.accepted.forEach(accepted => {
                        logger.info(`Código registrado: ${accepted.number} (carrier: ${accepted.carrier}, origem: ${this._getOriginDescription(accepted.origin)})`);
                    });

                    response.data.data.rejected.forEach(rejected => {
                        logger.warn(`Código rejeitado: ${rejected.number}, Erro: ${rejected.error.message}`);
                    });
                }
            }

            logger.info(`Registro concluído - Aceitos: ${totalAccepted}, Rejeitados: ${totalRejected}`);
            return { accepted: totalAccepted, rejected: totalRejected };
        } catch (error) {
            logger.error('Erro ao registrar códigos no 17track:', error);
            throw error;
        }
    }

    detectCarrier(trackingNumber) {
        // Verifica apenas Jadlog e Correios
        if (this.trackingPatterns.jadlog.test(trackingNumber)) {
            return this.carriers.jadlog;
        }
        
        if (this.trackingPatterns.correios.test(trackingNumber)) {
            return this.carriers.correios;
        }
        
        return null; // Deixa o 17track fazer a detecção automática
    }

    _getOriginDescription(origin) {
        switch (origin) {
            case 1: return 'Resultado confiável do sistema';
            case 2: return 'Carrier fornecido e confirmado';
            case 3: return 'Carrier detectado automaticamente';
            default: return 'Origem desconhecida';
        }
    }

    _createBatches(array, size) {
        const batches = [];
        for (let i = 0; i < array.length; i += size) {
            batches.push(array.slice(i, i + size));
        }
        return batches;
    }
}

module.exports = TrackingService;
