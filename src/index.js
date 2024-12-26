// Services
const {
    // Base Classes
    WhatsAppBase,
    TrackingBase,
    
    // Core Services
    WhatsAppService,
    WhatsAppImageService,
    AIServices,
    TrackingService,
    OrderValidationService,
    
    // Integration Services
    GroqServices,
    OpenAIService,
    NuvemshopService,
    
    // Media Services
    AudioService,
    ImageService,
    MediaManagerService,
    
    // Utility Services
    BusinessHoursService,
    WebhookService,
    CacheService,
    
    // Nuvemshop APIs
    NuvemshopAPIBase,
    NuvemshopOrderAPI,
    NuvemshopProductAPI
} = require('./services');

// Store
const { RedisStore } = require('./store/redis-store');

// Utils
const {
    formatTimeAgo,
    httpClient,
    detectImageFormatFromBuffer,
    detectImageFormat,
    validateImageBuffer,
    isValidBase64Image,
    Queue,
    decryptMedia
} = require('./utils');

// Configurations
const { 
    REDIS_CONFIG,
    OPENAI_CONFIG,
    GROQ_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    BUSINESS_HOURS,
    MEDIA_CONFIG,
    NUVEMSHOP_CONFIG
} = require('./config/settings');

module.exports = {
    // Base Classes
    WhatsAppBase,
    TrackingBase,
    
    // Core Services
    WhatsAppService,
    WhatsAppImageService,
    AIServices,
    TrackingService,
    OrderValidationService,
    
    // Integration Services
    GroqServices,
    OpenAIService,
    NuvemshopService,
    
    // Media Services
    AudioService,
    ImageService,
    MediaManagerService,
    
    // Utility Services
    BusinessHoursService,
    WebhookService,
    CacheService,
    
    // Nuvemshop APIs
    NuvemshopAPIBase,
    NuvemshopOrderAPI,
    NuvemshopProductAPI,
    
    // Store
    RedisStore,
    
    // Utils
    formatTimeAgo,
    httpClient,
    detectImageFormatFromBuffer,
    detectImageFormat,
    validateImageBuffer,
    isValidBase64Image,
    Queue,
    decryptMedia,
    
    // Configurations
    REDIS_CONFIG,
    OPENAI_CONFIG,
    GROQ_CONFIG,
    WHATSAPP_CONFIG,
    TRACKING_CONFIG,
    BUSINESS_HOURS,
    MEDIA_CONFIG,
    NUVEMSHOP_CONFIG
};