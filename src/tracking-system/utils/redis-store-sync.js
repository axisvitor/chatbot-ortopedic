const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const logger = require('./logger');
const { REDIS_CONFIG } = require('../../config/settings');

class RedisStoreSync {
    constructor() {
        const config = {
            socket: {
                host: REDIS_CONFIG.host,
                port: REDIS_CONFIG.port,
                tls: false,
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.3'
            },
            password: REDIS_CONFIG.password,
            retryStrategy: REDIS_CONFIG.retryStrategy
        };

        logger.info('[Redis] Configuração:', {
            host: config.socket.host,
            port: config.socket.port,
            tls: config.socket.tls,
            minVersion: config.socket.minVersion,
            maxVersion: config.socket.maxVersion
        });

        this.client = createClient(config);
        this.config = REDIS_CONFIG;

        this.client.on('error', (err) => {
            logger.error('[Redis] Erro no Redis:', {
                erro: err.message,
                stack: err.stack,
                timestamp: new Date().toISOString()
            });
        });

        this.client.on('connect', () => {
            logger.info('[Redis] Redis conectado com sucesso');
        });

        this.client.on('ready', () => {
            logger.info('[Redis] Cliente pronto para operações');
        });

        this.client.on('reconnecting', () => {
            logger.info('[Redis] Tentando reconectar...');
        });

        // Conecta ao Redis
        this.connect();
    }

    /**
     * Conecta ao Redis
     * @returns {Promise<void>}
     */
    async connect() {
        try {
            await this.client.connect();
        } catch (error) {
            logger.error('[Redis] Erro ao conectar:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém um valor do Redis
     * @param {string} key - Chave do valor
     * @returns {Promise<string|null>} Valor armazenado ou null se não existir
     */
    async get(key) {
        try {
            return await this.client.get(key);
        } catch (error) {
            logger.error('[Redis] Erro ao obter valor:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Define um valor no Redis
     * @param {string} key - Chave do valor
     * @param {string} value - Valor a ser armazenado
     * @param {number} ttl - Tempo de vida em segundos
     * @returns {Promise<void>}
     */
    async set(key, value, ttl = 0) {
        try {
            if (ttl > 0) {
                await this.client.setEx(key, ttl, value);
            } else {
                await this.client.set(key, value);
            }
        } catch (error) {
            logger.error('[Redis] Erro ao definir valor:', {
                key,
                ttl,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Remove um valor do Redis
     * @param {string} key - Chave do valor
     * @returns {Promise<void>}
     */
    async del(key) {
        try {
            await this.client.del(key);
        } catch (error) {
            logger.error('[Redis] Erro ao remover valor:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
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
            logger.error('[Redis] Erro ao fechar conexão:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Verifica conexão com Redis
     * @returns {Promise<boolean>}
     */
    async checkConnection() {
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao verificar conexão:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Adiciona valor ao final da lista
     * @param {string} key - Chave da lista
     * @param {string} value - Valor a ser adicionado
     * @returns {Promise<number>} Novo tamanho da lista
     */
    async rpush(key, value) {
        try {
            return await this.client.rPush(key, value);
        } catch (error) {
            logger.error('[Redis] Erro ao adicionar à lista:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Remove valor da lista
     * @param {string} key - Chave da lista
     * @param {number} count - Número de ocorrências a remover
     * @param {string} value - Valor a ser removido
     * @returns {Promise<number>} Número de elementos removidos
     */
    async lrem(key, count, value) {
        try {
            return await this.client.lRem(key, count, value);
        } catch (error) {
            logger.error('[Redis] Erro ao remover da lista:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém intervalo da lista
     * @param {string} key - Chave da lista
     * @param {number} start - Índice inicial
     * @param {number} stop - Índice final
     * @returns {Promise<string[]>} Valores no intervalo
     */
    async lrange(key, start, stop) {
        try {
            return await this.client.lRange(key, start, stop);
        } catch (error) {
            logger.error('[Redis] Erro ao obter intervalo da lista:', {
                key,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém código de rastreio do Redis
     * @param {string} code - Código de rastreio
     * @returns {Promise<Object|null>} Dados do código ou null se não existir
     */
    async getTrackingCode(code) {
        try {
            const key = `${REDIS_CONFIG.prefix.tracking.code}${code}`;
            const data = await this.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('[Redis] Erro ao obter código de rastreio:', {
                code,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Salva código de rastreio no Redis
     * @param {string} code - Código de rastreio
     * @param {Object} data - Dados do rastreio
     * @returns {Promise<void>}
     */
    async saveTrackingCode(code, data) {
        try {
            const key = `${REDIS_CONFIG.prefix.tracking.code}${code}`;
            await this.set(key, JSON.stringify(data), REDIS_CONFIG.ttl.tracking.status);
            
            logger.info('[Redis] Código de rastreio salvo:', {
                code,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[Redis] Erro ao salvar código de rastreio:', {
                code,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém todos os códigos de rastreio
     * @returns {Promise<Object[]>} Lista de códigos de rastreio
     */
    async getAllTrackingCodes() {
        try {
            const pattern = `${REDIS_CONFIG.prefix.tracking.code}*`;
            const keys = await this.client.keys(pattern);
            const codes = [];
            
            for (const key of keys) {
                const data = await this.get(key);
                if (data) {
                    codes.push(JSON.parse(data));
                }
            }

            return codes;
        } catch (error) {
            logger.error('[Redis] Erro ao obter todos os códigos:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Limpa cache de rastreio
     * @returns {Promise<void>}
     */
    async clearTrackingCache() {
        try {
            const pattern = `${REDIS_CONFIG.prefix.tracking.code}*`;
            const keys = await this.client.keys(pattern);
            
            if (keys.length > 0) {
                await this.client.del(keys);
            }
            
            logger.info('[Redis] Cache de rastreio limpo:', {
                keysRemoved: keys.length,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[Redis] Erro ao limpar cache:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Marca códigos como registrados no 17track
     * @param {string[]} codes - Lista de códigos
     * @returns {Promise<void>}
     */
    async markCodesAsRegistered(codes) {
        try {
            const multi = this.client.multi();
            const now = new Date().toISOString();

            for (const code of codes) {
                const key = `${REDIS_CONFIG.prefix.tracking.code}${code}`;
                const data = await this.get(key);
                
                if (data) {
                    const trackingData = JSON.parse(data);
                    trackingData.registeredAt = now;
                    trackingData.registered = true;
                    
                    multi.set(key, JSON.stringify(trackingData));
                }
            }

            await multi.exec();
            
            logger.info('[Redis] Códigos marcados como registrados:', {
                quantidade: codes.length,
                codigos: codes,
                timestamp: now
            });
        } catch (error) {
            logger.error('[Redis] Erro ao marcar códigos como registrados:', {
                codes,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Marca códigos como atualizados no 17track
     * @param {Object[]} updates - Lista de atualizações
     * @returns {Promise<void>}
     */
    async markCodesAsUpdated(updates) {
        try {
            const multi = this.client.multi();
            const now = new Date().toISOString();

            for (const update of updates) {
                const key = `${REDIS_CONFIG.prefix.tracking.code}${update.code}`;
                const data = await this.get(key);
                
                if (data) {
                    const trackingData = JSON.parse(data);
                    trackingData.lastUpdate = now;
                    trackingData.status = update.status;
                    trackingData.events = update.events;
                    
                    multi.set(key, JSON.stringify(trackingData));
                }
            }

            await multi.exec();
            
            logger.info('[Redis] Códigos atualizados:', {
                quantidade: updates.length,
                codigos: updates.map(u => u.code),
                timestamp: now
            });
        } catch (error) {
            logger.error('[Redis] Erro ao atualizar códigos:', {
                updates,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { RedisStoreSync };
