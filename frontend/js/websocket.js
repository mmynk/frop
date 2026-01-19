/**
 * WebSocket connection manager for Frop
 */
class FropSocket {
    constructor() {
        this.ws = null;
        this.sessionToken = null;
        this.listeners = new Map();
    }

    /**
     * Connect to the WebSocket server
     */
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${protocol}//${window.location.host}/ws`;

        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => this.emit('open');
        this.ws.onclose = () => this.emit('close');
        this.ws.onerror = (e) => this.emit('error', e);

        this.ws.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
                // Binary data (file chunk)
                this.emit('binary', event.data);
            } else {
                // JSON message
                try {
                    const msg = JSON.parse(event.data);
                    this.handleMessage(msg);
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            }
        };
    }

    /**
     * Disconnect from the server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Handle incoming JSON messages
     */
    handleMessage(msg) {
        switch (msg.type) {
            case 'connected':
                this.sessionToken = msg.sessionToken;
                this.emit('connected', msg);
                break;
            case 'peer_joined':
                this.emit('peer_joined');
                break;
            case 'peer_disconnected':
                this.emit('peer_disconnected');
                break;
            case 'error':
                this.emit('error', new Error(msg.error));
                break;
            case 'file_start':
                this.emit('file_start', msg);
                break;
            case 'file_end':
                this.emit('file_end', msg);
                break;
            default:
                console.warn('Unknown message type:', msg.type);
        }
    }

    /**
     * Join a room by code
     */
    join(code) {
        this.send({ type: 'join', code: code.toUpperCase() });
    }

    /**
     * Reconnect using session token
     */
    reconnect() {
        if (this.sessionToken) {
            this.send({ type: 'reconnect', sessionToken: this.sessionToken });
        }
    }

    /**
     * Send file start notification
     */
    sendFileStart(name, size) {
        this.send({ type: 'file_start', name, size });
    }

    /**
     * Send file end notification
     */
    sendFileEnd(name) {
        this.send({ type: 'file_end', name });
    }

    /**
     * Send binary data (file chunk)
     */
    sendBinary(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
    }

    /**
     * Send a JSON message
     */
    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    /**
     * Register an event listener
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * Remove an event listener
     */
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Emit an event to all listeners
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => cb(data));
        }
    }

    /**
     * Check if connected
     */
    get isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}

// Export singleton instance
window.fropSocket = new FropSocket();
