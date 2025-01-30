const axios = require('axios');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const logger = require('../../../utils/logger');

class NuvemshopHttpClient {
    constructor() {
        this.client = null;
        this.bucket = {
            tokens: NUVEMSHOP_CONFIG.api.rateLimit.bucketSize,
            lastRefill: Date.now(),
            queue: []
        };
        this.initializeClient();
    }

    /**
     * Inicializa o cliente HTTP
     */
    initializeClient() {
        // Garantir que a URL base está correta e inclui /v1
        const baseURL = NUVEMSHOP_CONFIG.apiUrl;

        // Validar o token de acesso
        if (!NUVEMSHOP_CONFIG.accessToken) {
            logger.error('TokenNaoEncontrado');
            throw new Error('Token de acesso da Nuvemshop não configurado');
        }

        // Log do token mascarado para debug
        const maskedToken = NUVEMSHOP_CONFIG.accessToken.substring(0, 6) + '...' + 
            NUVEMSHOP_CONFIG.accessToken.substring(NUVEMSHOP_CONFIG.accessToken.length - 4);

        logger.debug('InicializandoCliente', {
            baseURL,
            tokenMascarado: maskedToken,
            timestamp: new Date().toISOString()
        });

        // Configurar headers padrão
        const headers = {
            'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': NUVEMSHOP_CONFIG.api.userAgent,
            'Accept': 'application/json'
        };

        // Criar instância do axios com configuração completa
        this.client = axios.create({
            baseURL,
            headers,
            timeout: NUVEMSHOP_CONFIG.api.timeout
        });

        // Adiciona interceptors
        this._addRequestInterceptor();
        this._addResponseInterceptor();
    }

    /**
     * Implementa o algoritmo Leaky Bucket para rate limiting
     * @private
     */
    async _rateLimiter(config) {
        const now = Date.now();
        const { bucketSize, requestsPerSecond } = NUVEMSHOP_CONFIG.api.rateLimit;
        const refillRate = 1000 / requestsPerSecond; // ms por token
        
        // Calcula quantos tokens devem ser adicionados desde o último refill
        const timePassed = now - this.bucket.lastRefill;
        const tokensToAdd = Math.floor(timePassed / refillRate);
        
        // Atualiza os tokens no bucket
        this.bucket.tokens = Math.min(bucketSize, this.bucket.tokens + tokensToAdd);
        this.bucket.lastRefill = now;

        // Se não tem tokens disponíveis, espera
        if (this.bucket.tokens <= 0) {
            const waitTime = refillRate * (1 - this.bucket.tokens);
            logger.debug('RateLimitEsperando', {
                waitTime,
                tokens: this.bucket.tokens,
                timestamp: new Date().toISOString()
            });
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this._rateLimiter(config);
        }

        // Consome um token
        this.bucket.tokens--;
        return config;
    }

    /**
     * Adiciona interceptor de requisição
     * @private
     */
    _addRequestInterceptor() {
        this.client.interceptors.request.use(
            async config => {
                // Aplica rate limiting
                config = await this._rateLimiter(config);
                return config;
            },
            error => {
                logger.error('ErroRequisicao', {
                    erro: error.message,
                    config: error.config,
                    timestamp: new Date().toISOString()
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Adiciona interceptor de resposta
     * @private
     */
    _addResponseInterceptor() {
        this.client.interceptors.response.use(
            response => {
                // Atualiza o bucket baseado nos headers de rate limit
                const headers = response.headers || {};
                const { limit, remaining, reset } = NUVEMSHOP_CONFIG.api.rateLimit.headers;
                
                if (headers[limit]) {
                    this.bucket.tokens = parseInt(headers[remaining] || '0');
                    logger.debug('RateLimitAtualizado', {
                        limit: headers[limit],
                        remaining: headers[remaining],
                        reset: headers[reset],
                        timestamp: new Date().toISOString()
                    });
                }
                
                return response;
            },
            error => {
                // Se receber 429 (Too Many Requests), espera o tempo indicado
                if (error.response && error.response.status === 429) {
                    const resetTime = parseInt(error.response.headers[NUVEMSHOP_CONFIG.api.rateLimit.headers.reset] || '1000');
                    logger.warn('RateLimitExcedido', {
                        resetTime,
                        timestamp: new Date().toISOString()
                    });
                    return new Promise(resolve => {
                        setTimeout(() => resolve(this.client(error.config)), resetTime);
                    });
                }
                
                logger.error('ErroResposta', {
                    status: error.response?.status,
                    erro: error.message,
                    timestamp: new Date().toISOString()
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Executa uma requisição HTTP
     * @param {Object} config Configuração da requisição
     * @returns {Promise} Resposta da requisição
     */
    async request(config) {
        try {
            return await this.client.request(config);
        } catch (error) {
            logger.error('ErroRequisicao', {
                erro: error.message,
                config,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa o header Link para paginação
     * @param {string} linkHeader - Header Link da resposta
     * @returns {Object} Links processados
     */
    parseLinkHeader(linkHeader) {
        if (!linkHeader) return {};

        return linkHeader.split(',').reduce((acc, link) => {
            const match = link.match(/<(.+)>;\s*rel="(.+)"/);
            if (match) {
                acc[match[2]] = match[1];
            }
            return acc;
        }, {});
    }

    /**
     * Faz uma requisição com retry automático
     * @param {Object} config - Configuração da requisição
     * @param {number} retryCount - Número da tentativa atual
     * @returns {Promise} Resposta da requisição
     */
    async retryRequest(config, retryCount = 0) {
        const maxRetries = NUVEMSHOP_CONFIG.api.retryAttempts;
        const baseDelay = 1000; // 1 segundo

        if (retryCount >= maxRetries) {
            logger.error('MaximoTentativasExcedido', {
                config,
                tentativas: retryCount,
                timestamp: new Date().toISOString()
            });
            return Promise.reject(new Error('Número máximo de tentativas excedido'));
        }

        const delay = baseDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            return await this.client(config);
        } catch (error) {
            logger.warn('TentativaFalhou', {
                tentativa: retryCount + 1,
                erro: error.message,
                delay,
                timestamp: new Date().toISOString()
            });
            return this.retryRequest(config, retryCount + 1);
        }
    }

    /**
     * Testa a conexão com a API
     * @returns {Promise<boolean>} true se a conexão está ok
     */
    async testConnection() {
        try {
            logger.info('TestandoConexao', {
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });

            // Tenta buscar apenas 1 pedido para testar
            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: { per_page: 1 }
            });

            logger.info('ConexaoOK', {
                status: response.status,
                totalPedidos: response.data.length,
                url: response.config.url,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            logger.error('ErroTesteConexao', {
                erro: error.message,
                stack: error.stack,
                status: error.response?.status,
                data: error.response?.data,
                url: error.config?.url,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Obtém o cliente HTTP configurado
     * @returns {Object} Cliente HTTP
     */
    getClient() {
        return this.client;
    }
}

module.exports = { NuvemshopHttpClient };
