const { WhatsAppBase } = require('./whatsapp/base');
const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const AIServices = require('./ai-services');
const { RedisStore } = require('./redis-store');
const { TrackingBase } = require('./tracking/base');
const { TrackingService } = require('./tracking-service');
const { GroqServices } = require('./groq-services');
const AudioService = require('./audio-service');
const { ImageService } = require('./image-service');
const { BusinessHoursService } = require('./business-hours');
const { NuvemshopService } = require('./nuvemshop-service');
const { OrderValidationService } = require('./order-validation-service');
const { OpenAIService } = require('./openai-service');
const { WebhookService } = require('./webhook-service');
const { CacheService } = require('./cache-service');
const { MediaManagerService } = require('./media-manager-service');

// Exporta todos os serviços
module.exports = {
    WhatsAppBase,
    WhatsAppService,
    WhatsAppImageService,
    AIServices,
    RedisStore,
    TrackingBase,
    TrackingService,
    GroqServices,
    AudioService,
    ImageService,
    BusinessHoursService,
    NuvemshopService,
    OrderValidationService,
    OpenAIService,
    WebhookService,
    CacheService,
    MediaManagerService
};
