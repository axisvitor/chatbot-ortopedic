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
                'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': NUVEMSHOP_CONFIG.api.userAgent
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
        if (sanitized.headers && sanitized.headers['Authentication']) {
            sanitized.headers['Authentication'] = '[REDACTED]';
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
        try {
            // Adiciona o user_id ao endpoint se não começar com /
            const finalEndpoint = endpoint.startsWith('/') ? 
                `/${NUVEMSHOP_CONFIG.userId}${endpoint}` : 
                `/${NUVEMSHOP_CONFIG.userId}/${endpoint}`;

            // Se tiver opções de cache, tenta buscar do cache primeiro
            if (cacheOptions) {
                const cached = await this.cacheService.get(cacheOptions.key);
                if (cached) {
                    return JSON.parse(cached);
                }
            }

            // Sanitiza a configuração para log
            const sanitizedConfig = this.sanitizeConfig({
                method,
                url: finalEndpoint,
                ...options
            });

            // Log da request
            console.log('[Nuvemshop] Request:', sanitizedConfig);

            // Faz a request
            const response = await this.client[method](finalEndpoint, options);

            // Log da response
            console.log('[Nuvemshop] Response:', {
                status: response.status,
                data: response.data
            });

            // Se tiver opções de cache, salva no cache
            if (cacheOptions && response.data) {
                await this.cacheService.set(
                    cacheOptions.key,
                    JSON.stringify(response.data),
                    cacheOptions.ttl
                );
            }

            return response.data;
        } catch (error) {
            // Formata e loga o erro
            const formattedError = this.formatError(error);
            console.error('[Nuvemshop] Error:', formattedError);
            throw error;
        }
    }
}

module.exports = { NuvemshopApiBase };
