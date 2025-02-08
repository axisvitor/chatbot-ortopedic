require('dotenv').config();

const axios = require('axios');
const logger = require('../../utils/logger');
const { NUVEMSHOP_CONFIG } = require('../../config/settings');
const { NuvemshopHttpClient } = require('./utils/http-client');
const { NuvemshopCache } = require('./utils/cache');
const { NuvemshopFormatter } = require('./utils/formatter');
const { NuvemshopI18n } = require('./utils/i18n');

class NuvemshopBase {
    constructor(cacheService) {
        this.cacheService = cacheService;
        this.config = NUVEMSHOP_CONFIG;

        // Verifica se o cacheService está conectado
        if (cacheService && typeof cacheService.isConnected === 'function' && cacheService.isConnected()) {
            this.cache = new NuvemshopCache(cacheService);
            logger.info('[NuvemshopBase] Cache inicializado com sucesso', {
                timestamp: new Date().toISOString()
            });
        } else {
            this.cache = null;
            logger.warn('[NuvemshopBase] Cache não inicializado - Redis não conectado', {
                hasCacheService: !!cacheService,
                hasIsConnected: !!(cacheService && cacheService.isConnected),
                isConnected: !!(cacheService && cacheService.isConnected && cacheService.isConnected()),
                timestamp: new Date().toISOString()
            });
        }

        this.httpClient = new NuvemshopHttpClient();
        this.client = this.httpClient.getClient();

        // Inicializa cliente HTTP
        this.client = axios.create({
            baseURL: this.config.apiUrl,
            timeout: this.config.api.timeout,
            headers: {
                'Authentication': `bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': this.config.api.userAgent,
                'Accept': 'application/json'
            }
        });

        // Configurações de retry
        this.retryConfig = {
            attempts: this.config.api.retryAttempts,
            delays: this.config.api.retryDelays
        };

        // Rate limiting
        this.rateLimitConfig = this.config.api.rateLimit;
        this.requestCount = 0;
        this.lastRequestTime = Date.now();

        // Reseta contador de requisições periodicamente
        setInterval(() => {
            this.requestCount = 0;
            this.lastRequestTime = Date.now();
        }, this.rateLimitConfig.perMilliseconds);
    }

    /**
     * Verifica rate limit antes de fazer requisição
     * @protected
     */
    async _checkRateLimit() {
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;

        if (elapsed >= this.rateLimitConfig.perMilliseconds) {
            this.requestCount = 0;
            this.lastRequestTime = now;
        }

        if (this.requestCount >= this.rateLimitConfig.maxRequests) {
            const waitTime = this.rateLimitConfig.perMilliseconds - elapsed;
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this._checkRateLimit();
            }
        }

        this.requestCount++;
        return true;
    }

    /**
     * Faz requisição com retry automático e circuit breaker
     * @protected
     */
    async _makeRequest(method, endpoint, options = {}) {
        // Log request
        logger.debug('NuvemshopRequestStarted', {
            method,
            endpoint,
            options: JSON.stringify(options),
            timestamp: new Date().toISOString()
        });

        let lastError = null;
        for (let attempt = 1; attempt <= this.retryConfig.attempts; attempt++) {
            try {
                await this._checkRateLimit();
                
                const startTime = Date.now();
                const response = await this.client.request({
                    method,
                    url: endpoint,
                    ...options
                });

                // Log successful response
                logger.debug('NuvemshopRequestSuccess', {
                    method,
                    endpoint,
                    attempt,
                    duration: Date.now() - startTime,
                    status: response.status,
                    timestamp: new Date().toISOString()
                });

                return response.data;
            } catch (error) {
                lastError = error;
                const status = error.response?.status;
                const responseData = error.response?.data;

                // Determine if we should retry based on error type
                const shouldRetry = attempt < this.retryConfig.attempts && (
                    // Retry on server errors
                    status >= 500 || 
                    // Retry on rate limit errors
                    status === 429 ||
                    // Retry on network errors
                    !status && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
                );

                // Log error details
                logger.error('NuvemshopRequestError', {
                    method,
                    endpoint,
                    attempt,
                    error: error.message,
                    errorCode: error.code,
                    status,
                    responseData: JSON.stringify(responseData),
                    stack: error.stack,
                    willRetry: shouldRetry,
                    timestamp: new Date().toISOString()
                });

                if (shouldRetry) {
                    // Calculate delay with exponential backoff
                    const baseDelay = this.retryConfig.delays[attempt - 1] || 5000;
                    const jitter = Math.random() * 1000; // Add randomness to prevent thundering herd
                    const delay = Math.min(baseDelay * Math.pow(2, attempt - 1) + jitter, 30000); // Cap at 30 seconds

                    logger.info('NuvemshopRequestRetrying', {
                        method,
                        endpoint,
                        attempt,
                        nextAttempt: attempt + 1,
                        delay,
                        timestamp: new Date().toISOString()
                    });

                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // If we're not retrying, enhance the error with more context
                const enhancedError = new Error(`Nuvemshop API request failed: ${error.message}`);
                enhancedError.originalError = error;
                enhancedError.status = status;
                enhancedError.endpoint = endpoint;
                enhancedError.method = method;
                enhancedError.attempts = attempt;
                enhancedError.responseData = responseData;

                throw enhancedError;
            }
        }

        // If we've exhausted all retries
        logger.error('NuvemshopRequestExhaustedRetries', {
            method,
            endpoint,
            attempts: this.retryConfig.attempts,
            lastError: lastError.message,
            timestamp: new Date().toISOString()
        });

        throw lastError;
    }

    /**
     * Gera chave de cache
     * @protected
     */
    _generateCacheKey(prefix, ...parts) {
        return `${this.config.cache.prefix}${prefix}:${parts.join(':')}`;
    }

    // Formatação
    formatOrderStatus(status) {
        return NuvemshopFormatter.formatOrderStatus(status);
    }

    formatPrice(value) {
        return NuvemshopFormatter.formatPrice(value);
    }

    formatOrderSummary(order) {
        return NuvemshopFormatter.formatOrderSummary(order);
    }

    formatOrderResponse(order) {
        return NuvemshopFormatter.formatOrderResponse(order);
    }

    formatProductResponse(product) {
        return NuvemshopFormatter.formatProductResponse(product);
    }

    // Internacionalização
    processMultiLanguageResponse(data, mainLanguage = 'pt') {
        return NuvemshopI18n.processMultiLanguageResponse(data, mainLanguage);
    }

    processMultiLanguageData(data, mainLanguage = 'pt') {
        return NuvemshopI18n.processMultiLanguageData(data, mainLanguage);
    }

    prepareMultiLanguageData(data, multiLanguageFields = ['name', 'description']) {
        return NuvemshopI18n.prepareMultiLanguageData(data, multiLanguageFields);
    }

    // Cache
    generateCacheKey(prefix, identifier = '', params = {}) {
        return this.cache.generateCacheKey(prefix, identifier, params);
    }

    async getCachedData(cacheKey, fetchFunction, ttl) {
        return this.cache.getCachedData(cacheKey, fetchFunction, ttl);
    }

    async invalidateCache(prefix) {
        return this.cache.invalidateCache(prefix);
    }

    // HTTP
    parseLinkHeader(linkHeader) {
        return this.httpClient.parseLinkHeader(linkHeader);
    }

    async retryRequest(config, retryCount = 0) {
        return this.httpClient.retryRequest(config, retryCount);
    }

    async testConnection() {
        return this.httpClient.testConnection();
    }
}

module.exports = { NuvemshopBase };
