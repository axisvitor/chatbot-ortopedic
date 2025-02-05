const { RedisStoreSync } = require('./utils/redis-store-sync');
const logger = require('./utils/logger');

async function cleanProducts() {
    try {
        // Verifica a conexão primeiro
        const isConnected = await redis.checkConnection();
        if (!isConnected) {
            logger.error('Não foi possível estabelecer conexão com o Redis');
            return;
        }

        logger.info('Iniciando limpeza de produtos no Redis...');

        // Lista todas as chaves que contenham "product" ou "produtos"
        const productKeys = await redis.keys('*product*');
        const produtosKeys = await redis.keys('*produtos*');
        
        const allKeys = [...new Set([...productKeys, ...produtosKeys])];
        
        logger.info(`Encontradas ${allKeys.length} chaves de produtos`);

        // Deleta cada chave
        for (const key of allKeys) {
            try {
                const deleted = await redis.del(key);
                if (deleted) {
                    logger.info(`Chave deletada com sucesso: ${key}`);
                } else {
                    logger.warn(`Não foi possível deletar a chave: ${key}`);
                }
            } catch (error) {
                logger.error(`Erro ao deletar chave ${key}:`, error);
            }
        }

        logger.info('Processo de limpeza concluído!');

    } catch (error) {
        logger.error('Erro durante o processo de limpeza:', error);
    } finally {
        // Garante que a conexão seja fechada
        await redis.disconnect();
    }
}

// Executa a limpeza
cleanProducts();
