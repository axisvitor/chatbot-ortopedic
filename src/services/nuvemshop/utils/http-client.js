const axios = require('axios');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const logger = require('../../../utils/logger');

class NuvemshopHttpClient {
    constructor() {
        this.client = null;
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
            'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
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
     * Adiciona interceptor de request
     * @private
     */
    _addRequestInterceptor() {
        this.client.interceptors.request.use(request => {
            logger.debug('RequestNuvemshop', {
                url: request.url,
                method: request.method,
                params: request.params,
                headers: {
                    'Content-Type': request.headers['Content-Type'],
                    'User-Agent': request.headers['User-Agent'],
                    'Authentication': request.headers['Authentication']
                },
                timestamp: new Date().toISOString()
            });
            return request;
        });
    }

    /**
     * Adiciona interceptor de response
     * @private
     */
    _addResponseInterceptor() {
        this.client.interceptors.response.use(
            response => {
                logger.debug('ResponseNuvemshopSucesso', {
                    status: response.status,
                    data: response.data,
                    timestamp: new Date().toISOString()
                });
                return response;
            },
            error => {
                logger.error('ResponseNuvemshopErro', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
                return Promise.reject(error);
            }
        );
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
