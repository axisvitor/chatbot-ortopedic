class TrackingBase {
    constructor() {
        if (this.constructor === TrackingBase) {
            throw new Error('TrackingBase é uma classe abstrata e não pode ser instanciada diretamente');
        }
    }

    async initialize() {
        throw new Error('O método initialize deve ser implementado');
    }

    async getTrackingInfo(trackingCode) {
        throw new Error('O método getTrackingInfo deve ser implementado');
    }

    async validateTrackingCode(trackingCode) {
        throw new Error('O método validateTrackingCode deve ser implementado');
    }

    async getLastStatus(trackingCode) {
        throw new Error('O método getLastStatus deve ser implementado');
    }

    async getDeliveryPrediction(trackingCode) {
        throw new Error('O método getDeliveryPrediction deve ser implementado');
    }

    async getTrackingHistory(trackingCode) {
        throw new Error('O método getTrackingHistory deve ser implementado');
    }

    async subscribeToUpdates(trackingCode, callback) {
        throw new Error('O método subscribeToUpdates deve ser implementado');
    }

    async unsubscribeFromUpdates(trackingCode) {
        throw new Error('O método unsubscribeFromUpdates deve ser implementado');
    }
}

module.exports = { TrackingBase }; 