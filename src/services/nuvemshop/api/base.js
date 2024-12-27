const axios = require('axios');
const axiosRetry = require('axios-retry');
const rateLimit = require('axios-rate-limit');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const { CacheService } = require('../../../services/cache-service');

class NuvemshopApiBase {
    constructor(cacheService = null) {
        this.cacheService = cacheService;
        this.client = this.initializeClient();
        this.retryDelay = 1000; // Delay inicial de 1 segundo
        this.maxRetries = 3; // Máximo de 3 tentativas
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.minRequestInterval = 1000; // Mínimo de 1 segundo entre requisições
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    initializeClient() {
        // Configuração base do axios
        const client = axios.create({
            baseURL: NUVEMSHOP_CONFIG.apiUrl, // Remove /v1 da baseURL
            timeout: NUVEMSHOP_CONFIG.api.timeout,
            headers: {
                'Authentication': `Bearer ${NUVEMSHOP_CONFIG.accessToken}`,
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
            // Verifica o intervalo entre requisições
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            if (timeSinceLastRequest < this.minRequestInterval) {
                await this.sleep(this.minRequestInterval - timeSinceLastRequest);
            }

            // Adiciona o user_id ao endpoint se não começar com /
            const finalEndpoint = endpoint.startsWith('/') ? 
                endpoint : 
                `/${endpoint}`;

            // Se tiver opções de cache, tenta buscar do cache primeiro
            if (cacheOptions) {
                const cached = await this.cacheService.get(cacheOptions.key);
                if (cached) {
                    return JSON.parse(cached);
                }
            }

            let lastError = null;
            let currentDelay = this.retryDelay;

            for (let attempt = 0; attempt < this.maxRetries; attempt++) {
                try {
                    // Sanitiza a configuração para log
                    const sanitizedConfig = this.sanitizeConfig({
                        method,
                        url: finalEndpoint,
                        ...options
                    });

                    // Log da request
                    console.log('[Nuvemshop] Request:', {
                        ...sanitizedConfig,
                        attempt: attempt + 1,
                        maxAttempts: this.maxRetries
                    });

                    // Faz a request
                    const response = await this.client[method](finalEndpoint, options);
                    
                    // Atualiza o contador de requisições e timestamp
                    this.requestCount++;
                    this.lastRequestTime = Date.now();

                    // Log da response
                    console.log('[Nuvemshop] Response:', {
                        status: response.status,
                        requestCount: this.requestCount
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
                    lastError = error;

                    // Se for erro de rate limit (429) ou erro de servidor (5xx)
                    if (error.response?.status === 429 || (error.response?.status >= 500 && error.response?.status < 600)) {
                        console.log(`[Nuvemshop] Rate limit ou erro de servidor. Tentativa ${attempt + 1}/${this.maxRetries}. Aguardando ${currentDelay}ms...`);
                        await this.sleep(currentDelay);
                        currentDelay *= 2; // Delay exponencial
                        continue;
                    }

                    throw error;
                }
            }

            throw lastError;
        } catch (error) {
            // Formata e loga o erro
            const formattedError = this.formatError(error);
            console.error('[Nuvemshop] Error:', {
                ...formattedError,
                requestCount: this.requestCount
            });
            throw error;
        }
    }
}

module.exports = { NuvemshopApiBase };
