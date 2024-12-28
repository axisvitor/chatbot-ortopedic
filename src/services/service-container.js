/**
 * Container para gerenciar instâncias de serviços
 * Evita dependências circulares mantendo uma única instância de cada serviço
 */
class ServiceContainer {
    constructor() {
        this.services = new Map();
    }

    /**
     * Registra um serviço no container
     * @param {string} name - Nome do serviço
     * @param {Object} instance - Instância do serviço
     */
    register(name, instance) {
        this.services.set(name, instance);
    }

    /**
     * Obtém um serviço do container
     * @param {string} name - Nome do serviço
     * @returns {Object} Instância do serviço
     */
    get(name) {
        return this.services.get(name);
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
