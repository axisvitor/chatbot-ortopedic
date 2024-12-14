const { createClient } = require('redis');
const { REDIS_CONFIG } = require('../config/settings');

let redisClient = null;

class RedisStore {
    constructor() {
        if (!redisClient) {
            redisClient = createClient({
                socket: {
                    host: REDIS_CONFIG.host,
                    port: REDIS_CONFIG.port,
                    tls: false
                },
                password: REDIS_CONFIG.password
            });
            redisClient.on('error', (err) => console.error('Redis Client Error:', err));
        }
        this.client = redisClient;
    }

    async connect() {
        try {
            if (!this.client.isOpen) {
                await this.client.connect();
                console.log('Connected to Redis');
            }
        } catch (error) {
            console.error('Error connecting to Redis:', error);
            throw error;
        }
    }

    async searchProducts(query, limit = 5) {
        try {
            // Busca vetorial usando KNN
            const results = await this.client.ft.search(
                'idx:products',
                `*=>[KNN ${limit} @embedding $query_vector AS score]`,
                {
                    PARAMS: {
                        query_vector: query
                    },
                    RETURN: ['name', 'description', 'price', 'category', 'score'],
                    SORTBY: 'score',
                    DIALECT: 2
                }
            );

            return results.documents.map(doc => ({
                ...JSON.parse(doc.value),
                score: doc.score
            }));
        } catch (error) {
            console.error('Error searching products:', error);
            return [];
        }
    }

    async getProductsByCategory(category) {
        try {
            const results = await this.client.ft.search(
                'idx:products',
                `@category:{${category}}`,
                {
                    RETURN: ['name', 'description', 'price', 'category']
                }
            );
            return results.documents.map(doc => JSON.parse(doc.value));
        } catch (error) {
            console.error('Error getting products by category:', error);
            return [];
        }
    }

    async set(key, value, expireInSeconds = null) {
        try {
            if (expireInSeconds) {
                await this.client.set(key, JSON.stringify(value), {
                    EX: expireInSeconds
                });
            } else {
                await this.client.set(key, JSON.stringify(value));
            }
            return true;
        } catch (error) {
            console.error('Error setting Redis key:', error);
            return false;
        }
    }

    async get(key) {
        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error('Error getting Redis key:', error);
            return null;
        }
    }

    async delete(key) {
        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error('Error deleting Redis key:', error);
            return false;
        }
    }

    async disconnect() {
        try {
            if (this.client.isOpen) {
                await this.client.disconnect();
                console.log('Disconnected from Redis');
            }
        } catch (error) {
            console.error('Error disconnecting from Redis:', error);
            throw error;
        }
    }
}

module.exports = { RedisStore };
