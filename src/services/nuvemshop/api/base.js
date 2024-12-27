const axios = require('axios');
const axiosRetry = require('axios-retry');
const rateLimit = require('axios-rate-limit');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const { CacheService } = require('../../cache-service');

class NuvemshopApiBase {
    constructor() {
        this.client = this.initializeClient();
        this.cacheService = new CacheService();
    }

    initializeClient() {
        // Configuração base do axios
        const client = axios.create({
            baseURL: NUVEMSHOP_CONFIG.apiUrl,
            timeout: NUVEMSHOP_CONFIG.api.timeout,
            headers: {
                'User-Agent': NUVEMSHOP_CONFIG.api.userAgent,
                'Authorization': `Bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        // Configuração de retry
        axiosRetry(client, {
            retries: NUVEMSHOP_CONFIG.api.retryAttempts,
            retryDelay: (retryCount) => {
                const delay = NUVEMSHOP_CONFIG.api.retryDelays[retryCount - 1] || 
                    NUVEMSHOP_CONFIG.api.retryDelays[NUVEMSHOP_CONFIG.api.retryDelays.length - 1];
                return delay;
            },
            retryCondition: (error) => {
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    (error.response && error.response.status === 429);
            },
            onRetry: (retryCount, error, requestConfig) => {
                console.warn('[Nuvemshop] Tentativa de retry:', {
                    tentativa: retryCount,
                    erro: error.message,
                    url: requestConfig.url,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Configuração de rate limit
        const rateLimitedClient = rateLimit(client, NUVEMSHOP_CONFIG.api.rateLimit);

        // Interceptor para logging
        rateLimitedClient.interceptors.request.use(
            (config) => {
                const sanitizedConfig = this.sanitizeConfig(config);
                console.log('[Nuvemshop] Request:', sanitizedConfig);
                config.metadata = { startTime: new Date() };
                return config;
            },
            (error) => {
                console.error('[Nuvemshop] Erro no request:', error);
                return Promise.reject(error);
            }
        );

        rateLimitedClient.interceptors.response.use(
            (response) => {
                const duration = new Date() - response.config.metadata.startTime;
                console.log('[Nuvemshop] Response:', {
                    status: response.status,
                    url: response.config.url,
                    duration: `${duration}ms`
                });
                return response;
            },
            (error) => {
                if (error.response) {
                    console.error('[Nuvemshop] Erro na response:', {
                        status: error.response.status,
                        data: error.response.data,
                        url: error.config.url
                    });
                }
                return Promise.reject(error);
            }
        );

        return rateLimitedClient;
    }

    sanitizeConfig(config) {
        const sanitized = { ...config };
        if (sanitized.headers && sanitized.headers.Authorization) {
            sanitized.headers.Authorization = '[REDACTED]';
        }
        return sanitized;
    }

    formatError(error) {
        return {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
            timestamp: new Date().toISOString()
        };
    }

    async handleRequest(method, endpoint, options = {}, cacheOptions = null) {
        const cacheKey = cacheOptions?.key || `nuvemshop:${method}:${endpoint}`;
        const cacheTTL = cacheOptions?.ttl || NUVEMSHOP_CONFIG.cache.ttl.default;

        // Tenta buscar do cache primeiro se for GET
        if (method.toLowerCase() === 'get' && cacheOptions !== null) {
            const cachedData = await this.cacheService.get(cacheKey);
            if (cachedData) {
                console.log(' [Cache] Hit:', {
                    key: cacheKey,
                    method,
                    endpoint
                });
                return cachedData;
            }
        }

        try {
            const startTime = new Date();
            const response = await this.client[method](endpoint, options);
            const duration = new Date() - startTime;

            // Log de sucesso detalhado
            console.log(` [Nuvemshop] ${method.toUpperCase()} Success:`, {
                endpoint,
                duration: `${duration}ms`,
                status: response.status,
                timestamp: new Date().toISOString()
            });

            // Salva no cache se for GET
            if (method.toLowerCase() === 'get' && cacheOptions !== null) {
                await this.cacheService.set(cacheKey, response.data, cacheTTL);
                console.log(' [Cache] Saved:', {
                    key: cacheKey,
                    ttl: cacheTTL
                });
            }

            return response.data;
        } catch (error) {
            // Log de erro detalhado
            console.error(` [Nuvemshop] ${method.toUpperCase()} Error:`, {
                endpoint,
                error: error.message,
                status: error.response?.status,
                data: error.response?.data,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Adicionar informações úteis ao erro
            error.endpoint = endpoint;
            error.requestTime = new Date().toISOString();
            throw error;
        }
    }
}

module.exports = { NuvemshopApiBase };
