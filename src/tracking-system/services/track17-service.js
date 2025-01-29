const axios = require('axios');
const logger = require('../utils/logger');
const { CacheService } = require('./cache-service');
const { TRACKING_CONFIG } = require('../../config/settings');

class Track17Service {
    constructor() {
        this.config = TRACKING_CONFIG;
        this.cache = new CacheService();
        
        if (!this.config.apiKey) {
            logger.error('API Key do 17track não configurada!');
            throw new Error('TRACK17_API_KEY é obrigatório');
        }

        // Configuração do rate limiting
        this.rateLimiter = {
            maxRequests: 1000,  // Limite por hora
            interval: 3600000,  // 1 hora em ms
            currentRequests: 0,
            lastReset: Date.now()
        };
    }

    async getTrackingInfo(trackingNumbers) {
        if (!Array.isArray(trackingNumbers)) {
            trackingNumbers = [trackingNumbers];
        }

        // Validar códigos de rastreio
        trackingNumbers = trackingNumbers.filter(code => this._validateTrackingNumber(code));

        if (trackingNumbers.length === 0) {
            logger.warn('Nenhum código de rastreio válido fornecido');
            return [];
        }

        // Verifica cache primeiro
        const cached = await this.cache.get(trackingNumbers);
        if (cached) {
            logger.info('Usando dados em cache para:', trackingNumbers);
            return cached;
        }

        // Limita a 40 números por requisição (limite da API)
        if (trackingNumbers.length > 40) {
            logger.warn('Mais de 40 códigos de rastreio fornecidos, dividindo em lotes');
            return this._processBatches(trackingNumbers);
        }

        await this._checkRateLimit();

        try {
            logger.info('Consultando 17track para códigos:', trackingNumbers);
            
            const response = await this._makeRequest('/track/get', { numbers: trackingNumbers });
            const formattedResponse = this._formatResponse(response.data);

            // Salva no cache
            await this.cache.set(trackingNumbers, formattedResponse);

            return formattedResponse;
        } catch (error) {
            this._handleError(error, 'getTrackingInfo', { trackingNumbers });
            throw error;
        }
    }

    async registerForTracking(trackingNumbers) {
        if (!Array.isArray(trackingNumbers)) {
            trackingNumbers = [trackingNumbers];
        }

        // Validar códigos de rastreio
        trackingNumbers = trackingNumbers.filter(code => this._validateTrackingNumber(code));

        if (trackingNumbers.length === 0) {
            logger.warn('Nenhum código de rastreio válido para registrar');
            return { success: [], failed: [] };
        }

        await this._checkRateLimit();

        try {
            logger.info('Registrando códigos no 17track:', trackingNumbers);
            
            const response = await this._makeRequest('/track/register', { numbers: trackingNumbers });
            
            return {
                success: response.data.data.accepted || [],
                failed: response.data.data.rejected || []
            };
        } catch (error) {
            this._handleError(error, 'registerForTracking', { trackingNumbers });
            throw error;
        }
    }

    async _makeRequest(path, data, attempt = 1) {
        const maxAttempts = 3;
        const backoffTime = Math.pow(2, attempt) * 1000;

        try {
            const url = `${this.config.endpoint}${path}`;
            
            const response = await axios.post(url, data, {
                headers: {
                    '17token': this.config.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data.ret !== 0) {
                throw new Error(`Erro na API 17track: ${response.data.msg}`);
            }

            return response;
        } catch (error) {
            if (attempt < maxAttempts && this._isRetryableError(error)) {
                logger.warn(`Tentativa ${attempt} falhou, tentando novamente em ${backoffTime}ms`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                return this._makeRequest(path, data, attempt + 1);
            }
            throw error;
        }
    }

    _validateTrackingNumber(code) {
        if (!code || typeof code !== 'string') {
            logger.warn('Código de rastreio inválido:', code);
            return false;
        }

        // Regras básicas de validação
        const minLength = 8;
        const maxLength = 30;
        const validFormat = /^[A-Z0-9]+$/i;

        if (code.length < minLength || code.length > maxLength) {
            logger.warn(`Código ${code} tem tamanho inválido`);
            return false;
        }

        if (!validFormat.test(code)) {
            logger.warn(`Código ${code} contém caracteres inválidos`);
            return false;
        }

        return true;
    }

    async _checkRateLimit() {
        const now = Date.now();
        
        // Reset contador se passou 1 hora
        if (now - this.rateLimiter.lastReset >= this.rateLimiter.interval) {
            this.rateLimiter.currentRequests = 0;
            this.rateLimiter.lastReset = now;
        }

        if (this.rateLimiter.currentRequests >= this.rateLimiter.maxRequests) {
            const waitTime = this.rateLimiter.interval - (now - this.rateLimiter.lastReset);
            logger.error('Rate limit excedido, aguarde:', Math.ceil(waitTime / 1000), 'segundos');
            throw new Error('Rate limit exceeded');
        }

        this.rateLimiter.currentRequests++;
    }

    _isRetryableError(error) {
        // Erros que podem ser resolvidos com retry
        return (
            error.code === 'ECONNRESET' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNABORTED' ||
            (error.response && (error.response.status === 429 || error.response.status >= 500))
        );
    }

    _handleError(error, method, params) {
        const errorInfo = {
            method,
            params,
            error: {
                message: error.message,
                code: error.code,
                response: error.response?.data
            },
            timestamp: new Date().toISOString()
        };

        logger.error('Erro no serviço 17track:', errorInfo);
    }

    _formatResponse(apiResponse) {
        const accepted = apiResponse.data?.accepted || [];
        const rejected = apiResponse.data?.rejected || [];

        if (rejected.length > 0) {
            logger.warn('Alguns códigos foram rejeitados pelo 17track:', rejected);
        }

        return accepted.map(track => ({
            code: track.number,
            carrier: {
                code: track.carrier,
                name: track.carrier_name || 'Desconhecido'
            },
            status: this._mapStatus(track.status),
            lastUpdate: track.track_info?.latest?.time || null,
            location: {
                country: track.track_info?.latest?.country || null,
                city: track.track_info?.latest?.city || null,
                postal_code: track.track_info?.latest?.postal_code || null
            },
            events: this._formatEvents(track.track_info?.events || []),
            estimatedDelivery: track.track_info?.estimated_delivery || null,
            daysInTransit: track.track_info?.transit_time || 0,
            statusDetails: track.track_info?.latest?.description || null
        }));
    }

    _formatEvents(events) {
        return events.map(event => ({
            date: event.time,
            status: event.description,
            location: {
                country: event.country || null,
                city: event.city || null,
                postal_code: event.postal_code || null
            },
            statusCode: event.status
        }));
    }

    _mapStatus(status) {
        const statusMap = {
            0: { code: 0, text: 'pendente', details: 'Aguardando atualização' },
            10: { code: 10, text: 'postado', details: 'Objeto postado' },
            20: { code: 20, text: 'em_transito', details: 'Em trânsito' },
            30: { code: 30, text: 'entregue', details: 'Entregue ao destinatário' },
            35: { code: 35, text: 'falha', details: 'Tentativa de entrega falhou' },
            40: { code: 40, text: 'problema', details: 'Problema no transporte' },
            50: { code: 50, text: 'expirado', details: 'Rastreamento expirado' }
        };
        return statusMap[status] || { code: -1, text: 'desconhecido', details: 'Status desconhecido' };
    }

    async _processBatches(trackingNumbers) {
        const batchSize = 40;
        const batches = [];
        
        // Divide em lotes de 40
        for (let i = 0; i < trackingNumbers.length; i += batchSize) {
            const batch = trackingNumbers.slice(i, i + batchSize);
            
            // Verifica cache para cada lote
            const cached = await this.cache.get(batch);
            if (cached) {
                batches.push({ cached: true, data: cached });
            } else {
                batches.push({ cached: false, codes: batch });
            }
        }

        // Processa cada lote
        const results = [];
        for (const batch of batches) {
            if (batch.cached) {
                results.push(...batch.data);
                continue;
            }

            const batchResults = await this.getTrackingInfo(batch.codes);
            results.push(...batchResults);
            
            // Aguarda entre lotes para não sobrecarregar a API
            if (batches.indexOf(batch) < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return results;
    }
}

module.exports = { Track17Service };
