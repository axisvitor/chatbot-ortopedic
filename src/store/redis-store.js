const Redis = require('ioredis');
const { REDIS_CONFIG } = require('../config/settings');

class RedisStore {
    constructor() {
        this.client = new Redis({
            host: REDIS_CONFIG.host,
            port: REDIS_CONFIG.port,
            password: REDIS_CONFIG.password,
            keyPrefix: REDIS_CONFIG.prefix,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        });

        this.client.on('error', (error) => {
            console.error('[Redis] Erro de conexão:', error);
        });

        this.client.on('connect', () => {
            console.log('[Redis] Conectado com sucesso');
        });
    }

    /**
     * Armazena um valor no Redis
     * @param {string} key - Chave para armazenamento
     * @param {string} value - Valor a ser armazenado
     * @param {number} ttl - Tempo de vida em segundos
     * @returns {Promise<void>}
     */
    async set(key, value, ttl = REDIS_CONFIG.ttl) {
        try {
            if (ttl) {
                await this.client.set(key, value, 'EX', ttl);
            } else {
                await this.client.set(key, value);
            }
        } catch (error) {
            console.error('[Redis] Erro ao armazenar:', error);
            throw error;
        }
    }

    /**
     * Recupera um valor do Redis
     * @param {string} key - Chave para busca
     * @returns {Promise<string|null>} Valor armazenado ou null se não encontrado
     */
    async get(key) {
        try {
            return await this.client.get(key);
        } catch (error) {
            console.error('[Redis] Erro ao recuperar:', error);
            throw error;
        }
    }

    /**
     * Remove um valor do Redis
     * @param {string} key - Chave para remoção
     * @returns {Promise<void>}
     */
    async del(key) {
        try {
            await this.client.del(key);
        } catch (error) {
            console.error('[Redis] Erro ao remover:', error);
            throw error;
        }
    }

    /**
     * Verifica se uma chave existe
     * @param {string} key - Chave para verificação
     * @returns {Promise<boolean>} true se a chave existir
     */
    async exists(key) {
        try {
            return await this.client.exists(key) === 1;
        } catch (error) {
            console.error('[Redis] Erro ao verificar existência:', error);
            throw error;
        }
    }

    /**
     * Busca todas as chaves que correspondem a um padrão
     * @param {string} pattern - Padrão para busca (ex: "user:*")
     * @returns {Promise<string[]>} Lista de chaves encontradas
     */
    async keys(pattern) {
        try {
            return await this.client.keys(pattern);
        } catch (error) {
            console.error('[Redis] Erro ao buscar chaves:', error);
            throw error;
        }
    }

    /**
     * Fecha a conexão com o Redis
     * @returns {Promise<void>}
     */
    async close() {
        try {
            await this.client.quit();
        } catch (error) {
            console.error('[Redis] Erro ao fechar conexão:', error);
            throw error;
        }
    }

    /**
     * Adiciona um valor ao final de uma lista
     * @param {string} key - Chave da lista
     * @param {string} value - Valor a ser adicionado
     * @returns {Promise<number>} Novo tamanho da lista
     */
    async rpush(key, value) {
        try {
            return await this.client.rpush(key, value);
        } catch (error) {
            console.error('[Redis] Erro ao adicionar à lista:', error);
            throw error;
        }
    }

    /**
     * Recupera um intervalo de elementos de uma lista
     * @param {string} key - Chave da lista
     * @param {number} start - Índice inicial
     * @param {number} stop - Índice final (-1 para todos)
     * @returns {Promise<string[]>} Lista de valores
     */
    async lrange(key, start, stop) {
        try {
            return await this.client.lrange(key, start, stop);
        } catch (error) {
            console.error('[Redis] Erro ao recuperar lista:', error);
            throw error;
        }
    }

    /**
     * Define um tempo de expiração para uma chave
     * @param {string} key - Chave para definir expiração
     * @param {number} seconds - Tempo em segundos
     * @returns {Promise<boolean>} true se definido com sucesso
     */
    async expire(key, seconds) {
        try {
            return await this.client.expire(key, seconds);
        } catch (error) {
            console.error('[Redis] Erro ao definir expiração:', error);
            throw error;
        }
    }

    /**
     * Deleta chaves por padrão
     * @param {string} pattern - Padrão para deletar
     * @returns {Promise<boolean>} true se deletado com sucesso
     */
    async deletePattern(pattern) {
        try {
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(keys);
                console.log('🗑️ Chaves deletadas:', {
                    pattern,
                    quantidade: keys.length,
                    timestamp: new Date().toISOString()
                });
            }
            return true;
        } catch (error) {
            console.error('[Redis] Erro ao deletar chaves:', {
                pattern,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
}

module.exports = { RedisStore };
