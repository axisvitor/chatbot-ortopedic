const { createClient } = require('redis');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const logger = require('./logger');

class RedisStore {
    constructor() {
        const config = {
            socket: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                tls: false,
                rejectUnauthorized: false,
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.3'
            },
            password: process.env.REDIS_PASSWORD,
            retryStrategy: function(options) {
                if (options.error && options.error.code === 'ECONNREFUSED') {
                    logger.error('[Redis] Servidor recusou conexão');
                    return new Error('Servidor Redis indisponível');
                }
                if (options.total_retry_time > 1000 * 60 * 60) {
                    return new Error('Tempo máximo de retry excedido');
                }
                if (options.attempt > 10) {
                    return new Error('Máximo de tentativas excedido');
                }
                // Retry com exponential backoff
                return Math.min(options.attempt * 100, 3000);
            }
        };

        logger.info('[Redis] Configuração:', {
            host: config.socket.host,
            port: config.socket.port,
            tls: config.socket.tls,
            minVersion: config.socket.minVersion,
            maxVersion: config.socket.maxVersion
        });

        this.client = createClient(config);

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

        this.client.on('end', () => {
            logger.info('[Redis] Conexão encerrada');
        });

        // Conecta ao Redis
        this.connect();
    }

    async connect() {
        try {
            if (!this.client.isOpen) {
                await this.client.connect();
            }
        } catch (error) {
            logger.error('[Redis] Erro ao conectar ao Redis:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async checkConnection() {
        try {
            await this.ping();
            logger.info('[Redis] Conexão com Redis OK');
            return true;
        } catch (error) {
            logger.error('[Redis] Erro na conexão com Redis:', error);
            return false;
        }
    }

    async get(key) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            const value = await this.client.get(key);
            return value;
        } catch (error) {
            logger.error('[Redis] Erro ao buscar do cache:', {
                key,
                error: error.message
            });
            return null;
        }
    }

    async set(key, value, ttl = 3600) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            await this.client.set(key, value, {
                EX: ttl
            });
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao salvar no cache:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async del(key) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            await this.client.del(key);
            logger.info('[Redis] Chave deletada com sucesso:', {
                key,
                timestamp: new Date().toISOString()
            });
            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao deletar do cache:', {
                key,
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    async keys(pattern) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            return await this.client.keys(pattern);
        } catch (error) {
            logger.error('[Redis] Erro ao buscar chaves:', {
                pattern,
                error: error.message
            });
            return [];
        }
    }

    async exists(key) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            return await this.client.exists(key);
        } catch (error) {
            logger.error('[Redis] Erro ao verificar existência:', {
                key,
                error: error.message
            });
            return false;
        }
    }

    async ttl(key) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            return await this.client.ttl(key);
        } catch (error) {
            logger.error('[Redis] Erro ao buscar TTL:', {
                key,
                error: error.message
            });
            return -1;
        }
    }

    async hgetall(key) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            return await this.client.hGetAll(key);
        } catch (error) {
            logger.error('[Redis] Erro ao buscar todos os campos do hash:', {
                key,
                error: error.message
            });
            return {};
        }
    }

    async smembers(key) {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            return await this.client.sMembers(key);
        } catch (error) {
            logger.error('[Redis] Erro ao listar membros do set:', {
                key,
                error: error.message
            });
            return [];
        }
    }

    async ping() {
        try {
            if (!this.client.isOpen) {
                await this.connect();
            }
            const result = await this.client.ping();
            return result === 'PONG';
        } catch (error) {
            logger.error('[Redis] Erro ao fazer ping:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.client.isOpen) {
                await this.client.quit();
                logger.info('[Redis] Desconectado com sucesso');
            }
        } catch (error) {
            logger.error('[Redis] Erro ao desconectar:', error);
            throw error;
        }
    }

    // Métodos para gerenciamento de códigos de rastreio
    async saveTrackingCode(orderId, trackingData) {
        try {
            const key = `tracking:order:${orderId}`;
            const data = {
                orderId,
                code: trackingData.code,
                carrier: trackingData.carrier,
                status: trackingData.status,
                lastUpdate: trackingData.lastUpdate || new Date().toISOString(),
                lastCheck: new Date().toISOString(),
                location: trackingData.location || 'N/A',
                events: trackingData.events || [],
                statusDetails: trackingData.statusDetails || null,
                estimatedDelivery: trackingData.estimatedDelivery || null,
                daysInTransit: trackingData.daysInTransit || 0,
                registered17track: trackingData.registered17track || false
            };
            
            await this.client.hSet(key, data);
            logger.info(`[Redis] Código de rastreio salvo para pedido ${orderId}`);
            return true;
        } catch (error) {
            logger.error(`[Redis] Erro ao salvar código de rastreio: ${error.message}`);
            return false;
        }
    }

    async getTrackingCode(orderId) {
        try {
            const key = `tracking:order:${orderId}`;
            const data = await this.client.hGetAll(key);
            
            if (Object.keys(data).length === 0) {
                return null;
            }
            
            return data;
        } catch (error) {
            logger.error(`[Redis] Erro ao buscar código de rastreio: ${error.message}`);
            return null;
        }
    }

    async listAllTrackingCodes() {
        try {
            const keys = await this.keys('tracking:order:*');
            const trackingData = [];
            
            for (const key of keys) {
                const orderId = key.split(':')[2];
                const data = await this.getTrackingCode(orderId);
                if (data) {
                    trackingData.push({ orderId, ...data });
                }
            }
            
            return trackingData;
        } catch (error) {
            logger.error(`[Redis] Erro ao listar códigos de rastreio: ${error.message}`);
            return [];
        }
    }

    async deleteTrackingCode(orderId) {
        try {
            const key = `tracking:order:${orderId}`;
            await this.client.del(key);
            logger.info(`[Redis] Código de rastreio deletado para pedido ${orderId}`);
            return true;
        } catch (error) {
            logger.error(`[Redis] Erro ao deletar código de rastreio: ${error.message}`);
            return false;
        }
    }

    async getUnregisteredTrackingCodes() {
        try {
            const keys = await this.client.keys('tracking:order:*');
            const unregistered = [];

            for (const key of keys) {
                const data = await this.client.hGetAll(key);
                if (data && data.code && !data.registered17track) {
                    unregistered.push(data.code);
                }
            }

            return unregistered;
        } catch (error) {
            logger.error('[Redis] Erro ao buscar códigos não registrados:', error);
            return [];
        }
    }

    async markCodesAsRegistered(codes) {
        try {
            const keys = await this.client.keys('tracking:order:*');
            
            for (const key of keys) {
                const data = await this.client.hGetAll(key);
                if (data && data.code && codes.includes(data.code)) {
                    await this.client.hSet(key, {
                        ...data,
                        registered17track: true,
                        lastCheck: new Date().toISOString()
                    });
                }
            }

            return true;
        } catch (error) {
            logger.error('[Redis] Erro ao marcar códigos como registrados:', error);
            return false;
        }
    }

    async updateLastCheck(orderId) {
        try {
            const key = `tracking:order:${orderId}`;
            await this.client.hSet(key, 'lastCheck', new Date().toISOString());
            return true;
        } catch (error) {
            logger.error(`[Redis] Erro ao atualizar lastCheck: ${error.message}`);
            return false;
        }
    }
}

module.exports = { RedisStore };
