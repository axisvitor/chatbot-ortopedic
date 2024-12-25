// Importa todos os serviços do arquivo de serviços
const {
    AIServices,
    WhatsAppBase,
    WhatsAppService,
    WhatsAppImageService,
    OpenAIService,
    TrackingBase,
    TrackingService,
    OrderValidationService,
    GroqServices,
    BusinessHoursService,
    NuvemshopService,
    AudioService,
    ImageService,
    WebhookService,
    CacheService,
    MediaManagerService
} = require('./services');

// Store
const { RedisStore } = require('./store/redis-store');

// Configurações
const { REDIS_CONFIG } = require('./config/settings');

module.exports = {
    // Services
    AIServices,
    WhatsAppBase,
    WhatsAppService,
    WhatsAppImageService,
    OpenAIService,
    TrackingBase,
    TrackingService,
    OrderValidationService,
    GroqServices,
    BusinessHoursService,
    NuvemshopService,
    AudioService,
    ImageService,
    WebhookService,
    CacheService,
    MediaManagerService,

    // Store
    RedisStore,

    // Configs
    REDIS_CONFIG
}; 