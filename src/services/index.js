// Base Classes
const { WhatsAppBase } = require('./whatsapp/base');
const { TrackingBase } = require('./tracking/base');

// Services
const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { AIServices } = require('./ai-services');
const { TrackingService } = require('./tracking-service');
const { GroqServices } = require('./groq-services');
const { AudioService } = require('./audio-service');
const { ImageService } = require('./image-service');
const { BusinessHoursService } = require('./business-hours');
const { NuvemshopService } = require('./nuvemshop');
const { OrderValidationService } = require('./order-validation-service');
const { OpenAIService } = require('./openai-service');
const { WebhookService } = require('./webhook-service');
const { MediaManagerService } = require('./media-manager-service');
const { OpenAIVisionService } = require('./openai-vision-service');
const { FinancialService } = require('./financial-service');
const { DepartmentService } = require('./department-service');
const { CacheService } = require('./cache-service');

// Nuvemshop APIs
const { 
    NuvemshopAPIBase,
    NuvemshopOrderAPI,
    NuvemshopProductAPI 
} = require('./nuvemshop/api');

// Exporta todos os serviços
module.exports = {
    // Base Classes
    WhatsAppBase,
    TrackingBase,
    
    // Services
    WhatsAppService,
    WhatsAppImageService,
    AIServices,
    TrackingService,
    GroqServices,
    AudioService,
    ImageService,
    BusinessHoursService,
    NuvemshopService,
    OrderValidationService,
    OpenAIService,
    WebhookService,
    MediaManagerService,
    OpenAIVisionService,
    FinancialService,
    DepartmentService,
    CacheService,

    // Nuvemshop APIs
    NuvemshopAPIBase,
    NuvemshopOrderAPI,
    NuvemshopProductAPI
};
