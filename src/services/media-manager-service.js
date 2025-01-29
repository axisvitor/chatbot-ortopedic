const crypto = require('crypto');
const { RedisStore } = require('../store/redis-store');
const { WhatsAppService } = require('./whatsapp-service');
const { OpenAIVisionService } = require('./openai-vision-service');
const { REDIS_CONFIG } = require('../config/settings');

class MediaManagerService {
    constructor(audioService, imageService) {
        if (!imageService) throw new Error('ImageService é obrigatório');
        
        this.audioService = audioService;
        this.imageService = imageService;
        this.redisStore = new RedisStore();
        this.visionService = new OpenAIVisionService();
        
        // Configurações
        this.MAX_AUDIO_DURATION = 300; // 5 minutos
        this.MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
        this.ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'];
    }

    setAudioService(audioService) {
        if (!audioService) throw new Error('AudioService é obrigatório');
        this.audioService = audioService;
        console.log('[MediaManager] AudioService atualizado');
    }

    /**
     * Processa mídia recebida
     * @param {Object} message - Mensagem recebida
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processMedia(message) {
        try {
            const mediaType = this.getMediaType(message);
            const mediaId = this.generateMediaId(message);

            console.log('[MediaManager] Processando mídia:', {
                mediaType,
                mediaId,
                from: message.from
            });

            // Verifica cache
            const cached = await this.getCachedResult(mediaId, mediaType);
            if (cached) {
                console.log('[MediaManager] Retornando resultado do cache:', { mediaId });
                return cached;
            }

            // Processa com métricas
            return await this.processWithMetrics(mediaId, async () => {
                switch (mediaType) {
                    case 'audio':
                        return await this.processAudio(message);
                    case 'image':
                        return await this.processImage(message);
                    default:
                        throw new Error('Tipo de mídia não suportado');
                }
            });

        } catch (error) {
            console.error('[MediaManager] Erro ao processar mídia:', error);
            throw error;
        }
    }

    /**
     * Identifica o tipo de mídia
     * @param {Object} message - Mensagem recebida
     * @returns {string} Tipo de mídia
     */
    getMediaType(message) {
        if (message.audioMessage) return 'audio';
        if (message.imageMessage) return 'image';
        throw new Error('Tipo de mídia não identificado');
    }

    /**
     * Gera ID único para a mídia
     * @param {Object} message - Mensagem recebida
     * @returns {string} ID da mídia
     */
    generateMediaId(message) {
        const content = JSON.stringify({
            type: this.getMediaType(message),
            from: message.from,
            timestamp: message.timestamp,
            messageId: message.messageId
        });
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Processa áudio com validações
     * @param {Object} message - Mensagem com áudio
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processAudio(message) {
        // Validação de duração
        if (message.audioMessage.seconds > this.MAX_AUDIO_DURATION) {
            throw new Error(`Áudio muito longo. Máximo permitido: ${this.MAX_AUDIO_DURATION} segundos`);
        }

        // Processa o áudio
        const result = await this.audioService.processWhatsAppAudio(message);

        // Cache do resultado
        const mediaId = this.generateMediaId(message);
        await this.cacheResult(mediaId, 'audio', result);

        return result;
    }

    /**
     * Processa imagem com validações
     * @param {Object} message - Mensagem com imagem
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processImage(message) {
        try {
            console.log('🖼️ [MediaManager] Iniciando processamento de imagem:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid,
                mimetype: message.imageMessage?.mimetype,
                fileSize: message.imageMessage?.fileLength,
                timestamp: new Date().toISOString()
            });

            // Validação de tipo
            if (!this.ALLOWED_IMAGE_TYPES.includes(message.imageMessage.mimetype)) {
                console.error('❌ [MediaManager] Tipo de imagem não suportado:', {
                    tipo: message.imageMessage.mimetype,
                    permitidos: this.ALLOWED_IMAGE_TYPES
                });
                throw new Error(`Formato não suportado. Use: ${this.ALLOWED_IMAGE_TYPES.join(', ')}`);
            }

            // Validação de tamanho
            if (message.imageMessage.fileLength > this.MAX_IMAGE_SIZE) {
                console.error('❌ [MediaManager] Imagem muito grande:', {
                    tamanho: message.imageMessage.fileLength,
                    maximo: this.MAX_IMAGE_SIZE,
                    tamanhoMB: (message.imageMessage.fileLength / (1024 * 1024)).toFixed(2) + 'MB',
                    maximoMB: (this.MAX_IMAGE_SIZE / (1024 * 1024)).toFixed(2) + 'MB'
                });
                throw new Error(`Imagem muito grande. Máximo: ${this.MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
            }

            console.log('✅ [MediaManager] Validações iniciais OK:', {
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            // Processa a imagem usando OpenAI Vision
            console.log('🔄 [MediaManager] Enviando para processamento Vision:', {
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            const result = await this.visionService.processImage(message);

            console.log('✅ [MediaManager] Processamento Vision concluído:', {
                messageId: message.key?.id,
                temAnalise: !!result?.analysis,
                tamanhoAnalise: result?.analysis?.length,
                timestamp: new Date().toISOString()
            });

            // Cache do resultado
            const mediaId = this.generateMediaId(message);
            console.log('💾 [MediaManager] Salvando no cache:', {
                mediaId,
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            await this.cacheResult(mediaId, 'image', result);

            return result;
        } catch (error) {
            console.error('❌ [MediaManager] Erro ao processar imagem:', {
                erro: error.message,
                stack: error.stack,
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa com métricas
     * @param {string} mediaId - ID da mídia
     * @param {Function} processor - Função de processamento
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processWithMetrics(mediaId, processor) {
        const startTime = Date.now();
        try {
            const result = await processor();
            await this.recordMetrics(mediaId, 'success', Date.now() - startTime);
            return result;
        } catch (error) {
            await this.recordMetrics(mediaId, 'error', Date.now() - startTime);
            throw error;
        }
    }

    /**
     * Registra métricas de processamento
     * @param {string} mediaId - ID da mídia
     * @param {string} status - Status do processamento
     * @param {number} duration - Duração do processamento
     */
    async recordMetrics(mediaId, status, duration) {
        const metrics = {
            mediaId,
            status,
            duration,
            timestamp: Date.now()
        };

        await this.redisStore.rpush('media_metrics', JSON.stringify(metrics));
    }

    /**
     * Armazena resultado no cache
     * @param {string} mediaId - ID da mídia
     * @param {string} type - Tipo de mídia
     * @param {Object} result - Resultado do processamento
     */
    async cacheResult(mediaId, type, result) {
        try {
            const key = `${REDIS_CONFIG.prefix.ecommerce}media:${type}:${mediaId}`;
            await this.redisStore.set(key, result, REDIS_CONFIG.ttl.ecommerce.cache);
            console.log('[MediaManager] Resultado armazenado em cache:', { mediaId });
        } catch (error) {
            console.error('[MediaManager] Erro ao armazenar em cache:', error);
        }
    }

    /**
     * Obtém resultado do cache
     * @param {string} mediaId - ID da mídia
     * @param {string} type - Tipo de mídia
     * @returns {Promise<Object>} Resultado em cache ou null
     */
    async getCachedResult(mediaId, type) {
        try {
            const key = `${REDIS_CONFIG.prefix.ecommerce}media:${type}:${mediaId}`;
            const cached = await this.redisStore.get(key);
            return cached;
        } catch (error) {
            console.error('[MediaManager] Erro ao buscar do cache:', error);
            return null;
        }
    }
}

module.exports = { MediaManagerService };