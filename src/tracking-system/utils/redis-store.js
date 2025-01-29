const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const logger = require('./logger');
const { REDIS_CONFIG } = require('../../../config/settings');

class RedisStore {
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
    }

    /**
     * Conecta ao Redis
     */
    async connect() {
        try {
            if (!this.client.isOpen) {
                await this.client.connect();
            }
        } catch (error) {
            logger.error('[Redis] Erro ao conectar:', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Verifica conexão com Redis
     */
    async checkConnection() {
        try {
            await this.connect();
            await this.client.ping();
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao verificar conexão:', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Obtém valor do Redis
     */
    async get(key) {
        try {
            await this.connect();
            return await this.client.get(key);
        } catch (error) {
            logger.error('[Redis] Erro ao obter valor:', {
                key,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Define valor no Redis
     */
    async set(key, value, ttl = null) {
        try {
            await this.connect();
            if (ttl) {
                await this.client.set(key, value, { EX: ttl });
            } else {
                await this.client.set(key, value);
            }
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao definir valor:', {
                key,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Remove valor do Redis
     */
    async del(key) {
        try {
            await this.connect();
            await this.client.del(key);
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao remover valor:', {
                key,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Adiciona valor ao final da lista
     */
    async rpush(key, value) {
        try {
            await this.connect();
            return await this.client.rPush(key, value);
        } catch (error) {
            logger.error('[Redis] Erro ao adicionar à lista:', {
                key,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Remove valor da lista
     */
    async lrem(key, count, value) {
        try {
            await this.connect();
            return await this.client.lRem(key, count, value);
        } catch (error) {
            logger.error('[Redis] Erro ao remover da lista:', {
                key,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém intervalo da lista
     */
    async lrange(key, start, stop) {
        try {
            await this.connect();
            return await this.client.lRange(key, start, stop);
        } catch (error) {
            logger.error('[Redis] Erro ao obter intervalo da lista:', {
                key,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Salva código de rastreio
     */
    async saveTrackingCode(code, data) {
        try {
            const key = `${REDIS_CONFIG.prefix.tracking}code:${code}`;
            await this.set(key, JSON.stringify(data), REDIS_CONFIG.ttl.tracking.status);
            logger.info('[Redis] Código de rastreio salvo:', {
                code,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao salvar código de rastreio:', {
                code,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém código de rastreio
     */
    async getTrackingCode(code) {
        try {
            const key = `${REDIS_CONFIG.prefix.tracking}code:${code}`;
            const data = await this.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('[Redis] Erro ao obter código de rastreio:', {
                code,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Marca códigos como registrados no 17track
     */
    async markCodesAsRegistered(codes) {
        try {
            for (const code of codes) {
                const key = `${REDIS_CONFIG.prefix.tracking}code:${code}`;
                const data = await this.get(key);
                if (data) {
                    const trackingData = JSON.parse(data);
                    trackingData.meta.registered17track = true;
                    await this.set(key, JSON.stringify(trackingData), REDIS_CONFIG.ttl.tracking.status);
                }
            }
            logger.info('[Redis] Códigos marcados como registrados:', {
                codes,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao marcar códigos como registrados:', {
                codes,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Obtém todos os códigos de rastreio
     */
    async getAllTrackingCodes() {
        try {
            const pattern = `${REDIS_CONFIG.prefix.tracking}code:*`;
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
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Limpa cache de rastreio
     */
    async clearTrackingCache() {
        try {
            const pattern = `${REDIS_CONFIG.prefix.tracking}code:*`;
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(keys);
            }
            logger.info('[Redis] Cache de rastreio limpo:', {
                keysRemoved: keys.length,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao limpar cache:', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { RedisStore };
