const { WhatsAppService } = require('./whatsapp');
const { AIServices } = require('./ai-services');
const { RedisStore } = require('./redis-store');
const { TrackingService } = require('./tracking-service');
const { GroqServices } = require('./groq-services');
const { AudioService } = require('./audio-service');
const { ImageService } = require('./image-service');

// Exporta os serviços e o cliente axios para reuso
module.exports = {
    WhatsAppService,
    AIServices,
    RedisStore,
    TrackingService,
    GroqServices,
    AudioService,
    ImageService
};
