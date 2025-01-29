const axios = require('axios');
const moment = require('moment-timezone');
const logger = require('../../utils/logger');
const { NUVEMSHOP_CONFIG } = require('./config/settings');
const { NuvemshopHttpClient } = require('./utils/http-client');
const { NuvemshopCache } = require('./utils/cache');
const { NuvemshopFormatter } = require('./utils/formatter');
const { NuvemshopI18n } = require('./utils/i18n');

class NuvemshopBase {
    constructor(cacheService) {
        this.cacheService = cacheService;
        this.config = NUVEMSHOP_CONFIG;

        this.httpClient = new NuvemshopHttpClient();
        this.cache = new NuvemshopCache(cacheService);
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
     * Faz requisição com retry automático
     * @protected
     */
    async _makeRequest(method, endpoint, options = {}) {
        for (let attempt = 1; attempt <= this.retryConfig.attempts; attempt++) {
            try {
                await this._checkRateLimit();
                
                const response = await this.client.request({
                    method,
                    url: endpoint,
                    ...options
                });

                return response.data;
            } catch (error) {
                const shouldRetry = attempt < this.retryConfig.attempts && 
                                  error.response?.status >= 500;

                if (shouldRetry) {
                    const delay = this.retryConfig.delays[attempt - 1] || 5000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                logger.error('NuvemshopRequestError', {
                    method,
                    endpoint,
                    attempt,
                    error: error.message,
                    status: error.response?.status,
                    timestamp: new Date().toISOString()
                });

                throw error;
            }
        }
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
