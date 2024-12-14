const { WhatsAppService } = require('./whatsapp.js');
const { AIServices } = require('./ai-services.js');
const { RedisStore } = require('./redis-store.js');
const { TrackingService } = require('./tracking.js');
const { GroqServices } = require('./groq-services.js');

// Exporta os serviços e o cliente axios para reuso
module.exports = {
    WhatsAppService,
    AIServices,
    RedisStore,
    TrackingService,
    GroqServices
};
