/**
 * File transfer handling for Frop
 */
class FileTransfer {
    constructor(socket) {
        this.socket = socket;
        this.chunkSize = 64 * 1024; // 64KB chunks
        this.sending = new Map(); // name -> { file, progress }
        this.receiving = new Map(); // name -> { chunks, size, progress }
        this.onProgress = null;
        this.onComplete = null;
        this.onReceiveStart = null;

        // Listen for incoming file data
        this.socket.on('file_start', (msg) => this.handleFileStart(msg));
        this.socket.on('file_end', (msg) => this.handleFileEnd(msg));
        this.socket.on('binary', (data) => this.handleChunk(data));
    }

    /**
     * Send files to the connected peer
     * @param {FileList|File[]} files - Files to send
     */
    async sendFiles(files) {
        for (const file of files) {
            await this.sendFile(file);
        }
    }

    /**
     * Send a single file
     * @param {File} file - File to send
     * @param {string} [relativePath] - Optional relative path for directory structure
     */
    async sendFile(file, relativePath = null) {
        const name = relativePath || file.webkitRelativePath || file.name;

        this.sending.set(name, { file, progress: 0 });

        // Notify peer about incoming file
        this.socket.sendFileStart(name, file.size);

        // Read and send in chunks
        const reader = file.stream().getReader();
        let sent = 0;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Send chunk
                this.socket.sendBinary(value);
                sent += value.length;

                // Update progress
                const progress = Math.round((sent / file.size) * 100);
                this.sending.get(name).progress = progress;

                if (this.onProgress) {
                    this.onProgress({ name, progress, sent, total: file.size, direction: 'upload' });
                }
            }

            // Notify peer that file is complete
            this.socket.sendFileEnd(name);

            if (this.onComplete) {
                this.onComplete({ name, size: file.size, direction: 'upload' });
            }
        } finally {
            reader.releaseLock();
            this.sending.delete(name);
        }
    }

    /**
     * Handle incoming file start notification
     */
    handleFileStart(msg) {
        const { name, size } = msg;

        this.receiving.set(name, {
            chunks: [],
            size,
            received: 0,
            progress: 0
        });

        if (this.onReceiveStart) {
            this.onReceiveStart({ name, size });
        }
    }

    /**
     * Handle incoming binary chunk
     */
    handleChunk(data) {
        // Find the file currently being received
        // (assumes one file at a time for simplicity)
        for (const [name, info] of this.receiving) {
            if (info.received < info.size) {
                info.chunks.push(new Uint8Array(data));
                info.received += data.byteLength;
                info.progress = Math.round((info.received / info.size) * 100);

                if (this.onProgress) {
                    this.onProgress({
                        name,
                        progress: info.progress,
                        sent: info.received,
                        total: info.size,
                        direction: 'download'
                    });
                }
                break;
            }
        }
    }

    /**
     * Handle incoming file end notification
     */
    handleFileEnd(msg) {
        const { name } = msg;
        const info = this.receiving.get(name);

        if (info) {
            // Combine chunks into a blob
            const blob = new Blob(info.chunks);

            // Trigger download
            this.downloadBlob(blob, name);

            if (this.onComplete) {
                this.onComplete({ name, size: info.size, direction: 'download' });
            }

            this.receiving.delete(name);
        }
    }

    /**
     * Trigger a file download in the browser
     */
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename.split('/').pop(); // Use just the filename, not the path
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Format file size for display
     */
    static formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}

// Export
window.FileTransfer = FileTransfer;
