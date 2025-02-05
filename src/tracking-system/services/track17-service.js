const axios = require('axios');
const logger = require('../utils/logger');
const { CacheService } = require('./cache-service');
const { TRACKING_CONFIG, REDIS_CONFIG } = require('../../../config/settings');

class Track17Service {
    constructor() {
        this.config = TRACKING_CONFIG;
        this.cache = new CacheService();
        
        if (!this.config.apiKey || !this.config.endpoint) {
            logger.error('Configurações do 17track incompletas!');
            throw new Error('Configurações obrigatórias não encontradas');
        }

        // Cliente HTTP
        this.client = axios.create({
            baseURL: this.config.endpoint,
            timeout: 30000,
            headers: {
                '17token': this.config.apiKey,
                'Content-Type': 'application/json'
            }
        });

        // Configuração do rate limiting
        this.rateLimiter = {
            maxRequests: 1000,  // Limite por hora
            interval: 3600000,  // 1 hora em ms
            currentRequests: 0,
            lastReset: Date.now()
        };
    }

    /**
     * Obtém informações de rastreamento
     * @param {string|string[]} trackingNumbers - Código(s) de rastreio
     * @returns {Promise<Array>} Informações de rastreamento
     */
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
        const cacheKey = `${REDIS_CONFIG.prefix.tracking}info`;
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            logger.info('Usando dados em cache para:', {
                trackingNumbers,
                timestamp: new Date().toISOString()
            });
            return cached;
        }

        // Limita a 40 números por requisição (limite da API)
        if (trackingNumbers.length > 40) {
            logger.warn('Mais de 40 códigos de rastreio fornecidos, dividindo em lotes', {
                total: trackingNumbers.length,
                lotes: Math.ceil(trackingNumbers.length / 40)
            });
            return this._processBatches(trackingNumbers);
        }

        await this._checkRateLimit();

        try {
            logger.info('Consultando 17track:', {
                trackingNumbers,
                path: this.config.paths.track
            });
            
            const response = await this._makeRequest(this.config.paths.track, { numbers: trackingNumbers });
            const formattedResponse = this._formatResponse(response.data);

            // Salva no cache com TTL configurável
            await this.cache.set(
                cacheKey,
                formattedResponse,
                REDIS_CONFIG.ttl.tracking.status
            );

            return formattedResponse;
        } catch (error) {
            this._handleError(error, 'getTrackingInfo', { trackingNumbers });
            throw error;
        }
    }

    /**
     * Registra códigos para rastreamento
     * @param {string|string[]} trackingNumbers - Código(s) de rastreio
     * @returns {Promise<Object>} Resultado do registro
     */
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
            logger.info('Registrando códigos no 17track:', {
                trackingNumbers,
                path: this.config.paths.register
            });
            
            const response = await this._makeRequest(this.config.paths.register, { numbers: trackingNumbers });
            
            const result = {
                success: response.data.data.accepted || [],
                failed: response.data.data.rejected || []
            };

            // Registra sucesso/falha no cache
            const cacheKey = `${REDIS_CONFIG.prefix.tracking}register_status`;
            await this.cache.set(
                cacheKey,
                result,
                REDIS_CONFIG.ttl.tracking.status
            );

            return result;
        } catch (error) {
            this._handleError(error, 'registerForTracking', { trackingNumbers });
            throw error;
        }
    }

    /**
     * Faz uma requisição para a API
     * @private
     */
    async _makeRequest(path, data, attempt = 1) {
        const maxAttempts = 3;
        const backoffTime = Math.pow(2, attempt) * 1000;

        try {
            const response = await this.client.post(path, data);

            if (response.data.ret !== 0) {
                throw new Error(`Erro na API 17track: ${response.data.msg}`);
            }

            return response;
        } catch (error) {
            if (attempt < maxAttempts && this._isRetryableError(error)) {
                logger.warn('RetryingRequest', {
                    attempt,
                    backoffTime,
                    path,
                    error: error.message
                });
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                return this._makeRequest(path, data, attempt + 1);
            }
            throw error;
        }
    }

    /**
     * Valida um código de rastreio
     * @private
     */
    _validateTrackingNumber(code) {
        if (!code || typeof code !== 'string') {
            logger.warn('Código de rastreio inválido:', { code });
            return false;
        }

        // Regras básicas de validação
        const minLength = 8;
        const maxLength = 30;
        const validFormat = /^[A-Z0-9]+$/i;

        if (code.length < minLength || code.length > maxLength) {
            logger.warn('Código com tamanho inválido:', {
                code,
                length: code.length,
                minLength,
                maxLength
            });
            return false;
        }

        if (!validFormat.test(code)) {
            logger.warn('Código com formato inválido:', { code });
            return false;
        }

        // Verifica se é uma transportadora suportada
        const carrier = this._detectCarrier(code);
        if (!this.config.carriers.includes(carrier)) {
            logger.warn('Transportadora não suportada:', {
                code,
                carrier,
                supported: this.config.carriers
            });
            return false;
        }

        return true;
    }

    /**
     * Verifica limites de requisição
     * @private
     */
    async _checkRateLimit() {
        const now = Date.now();
        
        // Reset contador se passou 1 hora
        if (now - this.rateLimiter.lastReset >= this.rateLimiter.interval) {
            this.rateLimiter.currentRequests = 0;
            this.rateLimiter.lastReset = now;
        }

        if (this.rateLimiter.currentRequests >= this.rateLimiter.maxRequests) {
            const waitTime = this.rateLimiter.interval - (now - this.rateLimiter.lastReset);
            logger.error('Rate limit excedido:', {
                currentRequests: this.rateLimiter.currentRequests,
                maxRequests: this.rateLimiter.maxRequests,
                waitTime: Math.ceil(waitTime / 1000)
            });
            throw new Error('Rate limit exceeded');
        }

        this.rateLimiter.currentRequests++;
    }

    /**
     * Verifica se o erro pode ser retentado
     * @private
     */
    _isRetryableError(error) {
        return (
            error.code === 'ECONNRESET' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNABORTED' ||
            (error.response && (error.response.status === 429 || error.response.status >= 500))
        );
    }

    /**
     * Trata erros do serviço
     * @private
     */
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

    /**
     * Formata resposta da API
     * @private
     */
    _formatResponse(apiResponse) {
        const accepted = apiResponse.data?.accepted || [];
        const rejected = apiResponse.data?.rejected || [];

        if (rejected.length > 0) {
            logger.warn('Códigos rejeitados:', {
                rejected,
                reason: apiResponse.data?.rejectedReason
            });
        }

        return accepted.map(tracking => ({
            code: tracking.number,
            carrier: this._detectCarrier(tracking.number),
            status: this._normalizeStatus(tracking.status),
            lastUpdate: tracking.lastUpdateTime,
            history: tracking.events || []
        }));
    }

    /**
     * Detecta a transportadora pelo código
     * @private
     */
    _detectCarrier(code) {
        // Implementar lógica de detecção de transportadora
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

module.exports = { Track17Service };
