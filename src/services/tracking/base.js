/**
 * Classe base abstrata para serviços de rastreamento.
 * Implementa o padrão Template Method definindo a interface que todos os serviços de rastreio devem seguir.
 */
class TrackingBase {
    constructor() {
        if (this.constructor === TrackingBase) {
            throw new Error('TrackingBase é uma classe abstrata e não pode ser instanciada diretamente');
        }
        
        // Estado inicial do serviço
        this.initialized = false;
    }

    /**
     * Inicializa o serviço de rastreamento.
     * Deve ser chamado antes de usar qualquer outro método.
     * @throws {Error} Se a inicialização falhar
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error('O método initialize deve ser implementado');
    }

    /**
     * Obtém informações completas de um código de rastreio.
     * @param {string} trackingCode - Código de rastreio a ser consultado
     * @throws {Error} Se o código for inválido ou a consulta falhar
     * @returns {Promise<Object>} Objeto com informações do rastreio
     */
    async getTrackingInfo(trackingCode) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        throw new Error('O método getTrackingInfo deve ser implementado');
    }

    /**
     * Valida um código de rastreio.
     * @param {string} trackingCode - Código de rastreio a ser validado
     * @throws {Error} Se o código for inválido
     * @returns {Promise<boolean>} true se válido, false se inválido
     */
    async validateTrackingCode(trackingCode) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        throw new Error('O método validateTrackingCode deve ser implementado');
    }

    /**
     * Obtém o último status de um rastreio.
     * @param {string} trackingCode - Código de rastreio
     * @throws {Error} Se o código for inválido ou a consulta falhar
     * @returns {Promise<Object>} Objeto com o último status
     */
    async getLastStatus(trackingCode) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        throw new Error('O método getLastStatus deve ser implementado');
    }

    /**
     * Obtém previsão de entrega.
     * @param {string} trackingCode - Código de rastreio
     * @throws {Error} Se o código for inválido ou a consulta falhar
     * @returns {Promise<Object>} Objeto com a previsão de entrega
     */
    async getDeliveryPrediction(trackingCode) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        throw new Error('O método getDeliveryPrediction deve ser implementado');
    }

    /**
     * Obtém histórico completo de status.
     * @param {string} trackingCode - Código de rastreio
     * @throws {Error} Se o código for inválido ou a consulta falhar
     * @returns {Promise<Array>} Array com histórico de status
     */
    async getTrackingHistory(trackingCode) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        throw new Error('O método getTrackingHistory deve ser implementado');
    }

    /**
     * Registra para receber atualizações de um código.
     * @param {string} trackingCode - Código de rastreio
     * @param {Function} callback - Função a ser chamada quando houver atualizações
     * @throws {Error} Se o registro falhar
     * @returns {Promise<void>}
     */
    async subscribeToUpdates(trackingCode, callback) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        
        if (typeof callback !== 'function') {
            throw new Error('O callback deve ser uma função');
        }
        
        throw new Error('O método subscribeToUpdates deve ser implementado');
    }

    /**
     * Cancela o registro de atualizações.
     * @param {string} trackingCode - Código de rastreio
     * @throws {Error} Se o cancelamento falhar
     * @returns {Promise<void>}
     */
    async unsubscribeFromUpdates(trackingCode) {
        this.checkInitialized();
        this.validateTrackingCodeFormat(trackingCode);
        throw new Error('O método unsubscribeFromUpdates deve ser implementado');
    }

    /**
     * Verifica se o serviço foi inicializado.
     * @private
     * @throws {Error} Se o serviço não foi inicializado
     */
    checkInitialized() {
        if (!this.initialized) {
            throw new Error('O serviço de rastreamento não foi inicializado. Chame initialize() primeiro.');
        }
    }

    /**
     * Valida o formato básico do código de rastreio.
     * @private
     * @param {string} trackingCode - Código de rastreio a ser validado
     * @throws {Error} Se o código estiver em formato inválido
     */
    validateTrackingCodeFormat(trackingCode) {
        if (!trackingCode || typeof trackingCode !== 'string') {
            throw new Error('Código de rastreio inválido: deve ser uma string não vazia');
        }
        
        if (trackingCode.length < 8 || trackingCode.length > 50) {
            throw new Error('Código de rastreio inválido: comprimento deve estar entre 8 e 50 caracteres');
        }
        
        // Permite apenas letras, números e alguns caracteres especiais comuns em códigos de rastreio
        if (!/^[A-Za-z0-9\-_.]+$/.test(trackingCode)) {
            throw new Error('Código de rastreio inválido: formato incorreto');
        }
    }
}

module.exports = { TrackingBase };