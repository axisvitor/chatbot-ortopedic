/**
 * Container para gerenciar instâncias de serviços
 * Evita dependências circulares mantendo uma única instância de cada serviço
 */
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { WhatsAppAudioService } = require('./whatsapp-audio-service');
const { MediaManagerService } = require('./media-manager-service');
const { OpenAIService } = require('./openai-service');

class ServiceContainer {
    constructor() {
        this.services = new Map();
        this._initializeServices();
    }

    _initializeServices() {
        // Inicializa serviços base
        const imageService = new WhatsAppImageService();
        const audioService = new WhatsAppAudioService();
        const mediaManager = new MediaManagerService(audioService, imageService);
        const openaiService = new OpenAIService();

        // Registra no container
        this.register('whatsappImage', imageService);
        this.register('whatsappAudio', audioService);
        this.register('mediaManager', mediaManager);
        this.register('openai', openaiService);
    }

    /**
     * Registra um serviço no container
     * @param {string} name - Nome do serviço
     * @param {Object} service - Instância do serviço
     */
    register(name, service) {
        if (this.services.has(name)) {
            console.warn(`[Container] Serviço '${name}' já registrado, sobrescrevendo...`);
        }
        this.services.set(name, service);
    }

    /**
     * Obtém um serviço do container
     * @param {string} name - Nome do serviço
     * @returns {Object} Instância do serviço
     */
    get(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`[Container] Serviço '${name}' não encontrado`);
        }
        return service;
    }

    /**
     * Remove um serviço do container
     * @param {string} name - Nome do serviço
     */
    remove(name) {
        this.services.delete(name);
    }

    /**
     * Limpa todos os serviços
     */
    clear() {
        this.services.clear();
    }
}

// Exporta uma única instância do container
const container = new ServiceContainer();
module.exports = { container };
