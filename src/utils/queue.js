class Queue {
    constructor() {
        this.items = [];
        this.processing = false;
    }

    enqueue(item) {
        this.items.push(item);
        this.processNext();
    }

    dequeue() {
        if (this.isEmpty()) {
            return null;
        }
        return this.items.shift();
    }

    peek() {
        if (this.isEmpty()) {
            return null;
        }
        return this.items[0];
    }

    isEmpty() {
        return this.items.length === 0;
    }

    size() {
        return this.items.length;
    }

    async processNext() {
        if (this.processing || this.isEmpty()) {
            return;
        }

        this.processing = true;

        try {
            const item = this.peek();
            if (item && item.process) {
                await item.process();
            }
            this.dequeue();
        } catch (error) {
            console.error('Erro ao processar item da fila:', error);
        } finally {
            this.processing = false;
            if (!this.isEmpty()) {
                this.processNext();
            }
        }
    }

    clear() {
        this.items = [];
        this.processing = false;
    }
}

module.exports = { Queue };