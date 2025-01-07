require('dotenv').config({ path: '../../.env' });
const { RedisStore } = require('./utils/redis-store');
const logger = console;

async function inspectRedis() {
    const redis = new RedisStore();
    
    try {
        // Connect to Redis
        await redis.checkConnection();
        logger.info('Connected to Redis successfully');

        // Get all keys
        const keys = await redis.keys('*');
        logger.info(`Found ${keys.length} keys in Redis`);

        // Inspect each key
        for (const key of keys) {
            try {
                const value = await redis.get(key);
                logger.info('-------------------');
                logger.info(`Key: ${key}`);
                logger.info(`Value: ${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);
            } catch (error) {
                logger.error(`Error getting value for key ${key}:`, error.message);
            }
        }

    } catch (error) {
        logger.error('Error during Redis inspection:', error);
    } finally {
        await redis.disconnect();
    }
}

// Run the inspection
inspectRedis().then(() => {
    logger.info('Redis inspection completed');
}).catch(error => {
    logger.error('Failed to complete Redis inspection:', error);
});
