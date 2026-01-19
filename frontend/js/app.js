/**
 * Frop - Main Application
 */
(function() {
    // State
    let currentView = 'landing';
    let roomCode = null;
    let peerConnected = false;
    let transfer = null;

    // DOM Elements
    const views = {
        landing: document.getElementById('landing'),
        waiting: document.getElementById('waiting'),
        connected: document.getElementById('connected'),
        disconnected: document.getElementById('disconnected')
    };

    const elements = {
        createRoom: document.getElementById('createRoom'),
        joinRoom: document.getElementById('joinRoom'),
        codeInput: document.getElementById('codeInput'),
        roomCode: document.getElementById('roomCode'),
        cancelRoom: document.getElementById('cancelRoom'),
        dropzone: document.getElementById('dropzone'),
        fileInput: document.getElementById('fileInput'),
        folderInput: document.getElementById('folderInput'),
        selectFiles: document.getElementById('selectFiles'),
        selectFolder: document.getElementById('selectFolder'),
        transferList: document.getElementById('transferList'),
        reconnect: document.getElementById('reconnect'),
        backToLanding: document.getElementById('backToLanding')
    };

    // Initialize
    function init() {
        setupEventListeners();
        setupSocketListeners();
    }

    // View Management
    function showView(name) {
        Object.entries(views).forEach(([key, el]) => {
            el.classList.toggle('active', key === name);
        });
        currentView = name;
    }

    // Event Listeners
    function setupEventListeners() {
        // Create room
        elements.createRoom.addEventListener('click', createRoom);

        // Join room
        elements.joinRoom.addEventListener('click', joinRoom);
        elements.codeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') joinRoom();
        });

        // Cancel room
        elements.cancelRoom.addEventListener('click', () => {
            fropSocket.disconnect();
            showView('landing');
        });

        // File selection
        elements.selectFiles.addEventListener('click', () => elements.fileInput.click());
        elements.selectFolder.addEventListener('click', () => elements.folderInput.click());

        elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                sendFiles(e.target.files);
            }
        });

        elements.folderInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                sendFiles(e.target.files);
            }
        });

        // Drag and drop
        setupDropzone();

        // Reconnect
        elements.reconnect.addEventListener('click', () => {
            fropSocket.connect();
            fropSocket.on('open', () => fropSocket.reconnect());
        });

        elements.backToLanding.addEventListener('click', () => {
            fropSocket.disconnect();
            showView('landing');
        });
    }

    // Dropzone setup
    function setupDropzone() {
        const dropzone = elements.dropzone;

        ['dragenter', 'dragover'].forEach(event => {
            dropzone.addEventListener(event, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(event => {
            dropzone.addEventListener(event, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            });
        });

        dropzone.addEventListener('drop', (e) => {
            const items = e.dataTransfer.items;
            if (items) {
                handleDropItems(items);
            } else {
                sendFiles(e.dataTransfer.files);
            }
        });
    }

    // Handle dropped items (supports directories)
    async function handleDropItems(items) {
        const files = [];

        for (const item of items) {
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    await readEntry(entry, files, '');
                }
            }
        }

        if (files.length > 0) {
            sendFilesWithPaths(files);
        }
    }

    // Recursively read directory entries
    async function readEntry(entry, files, path) {
        if (entry.isFile) {
            const file = await new Promise((resolve) => entry.file(resolve));
            files.push({ file, path: path + file.name });
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await new Promise((resolve) => reader.readEntries(resolve));
            for (const childEntry of entries) {
                await readEntry(childEntry, files, path + entry.name + '/');
            }
        }
    }

    // Socket Listeners
    function setupSocketListeners() {
        fropSocket.on('connected', (msg) => {
            if (peerConnected || msg.sessionToken) {
                // Both peers are connected
                showView('connected');
                setupTransfer();
            }
        });

        fropSocket.on('peer_joined', () => {
            peerConnected = true;
            showView('connected');
            setupTransfer();
        });

        fropSocket.on('peer_disconnected', () => {
            peerConnected = false;
            showView('disconnected');
        });

        fropSocket.on('close', () => {
            if (currentView === 'connected') {
                showView('disconnected');
            }
        });

        fropSocket.on('error', (err) => {
            console.error('Socket error:', err);
            alert(err.message || 'Connection error');
        });
    }

    // Setup file transfer
    function setupTransfer() {
        if (!transfer) {
            transfer = new FileTransfer(fropSocket);

            transfer.onReceiveStart = ({ name, size }) => {
                addTransferItem(name, size, 'download');
            };

            transfer.onProgress = ({ name, progress, direction }) => {
                updateTransferProgress(name, progress, direction);
            };

            transfer.onComplete = ({ name, direction }) => {
                markTransferComplete(name, direction);
            };
        }
    }

    // Create a new room
    async function createRoom() {
        try {
            const response = await fetch('/api/room', { method: 'POST' });
            const data = await response.json();

            roomCode = data.code;
            elements.roomCode.textContent = roomCode;

            fropSocket.connect();
            fropSocket.on('open', () => fropSocket.join(roomCode));

            showView('waiting');
        } catch (err) {
            console.error('Failed to create room:', err);
            alert('Failed to create room');
        }
    }

    // Join an existing room
    function joinRoom() {
        const code = elements.codeInput.value.trim().toUpperCase();
        if (code.length !== 6) {
            alert('Please enter a 6-character code');
            return;
        }

        roomCode = code;
        fropSocket.connect();
        fropSocket.on('open', () => fropSocket.join(code));
    }

    // Send files
    function sendFiles(fileList) {
        if (!transfer || !peerConnected) {
            alert('Not connected to peer');
            return;
        }

        for (const file of fileList) {
            const name = file.webkitRelativePath || file.name;
            addTransferItem(name, file.size, 'upload');
        }

        transfer.sendFiles(fileList);
    }

    // Send files with custom paths (from drag-drop)
    function sendFilesWithPaths(filesWithPaths) {
        if (!transfer || !peerConnected) {
            alert('Not connected to peer');
            return;
        }

        for (const { file, path } of filesWithPaths) {
            addTransferItem(path, file.size, 'upload');
            transfer.sendFile(file, path);
        }
    }

    // UI: Add transfer item
    function addTransferItem(name, size, direction) {
        const id = `transfer-${direction}-${name.replace(/[^a-z0-9]/gi, '-')}`;

        // Don't add if already exists
        if (document.getElementById(id)) return;

        const item = document.createElement('div');
        item.className = 'transfer-item';
        item.id = id;
        item.innerHTML = `
            <div class="name">${escapeHtml(name)}</div>
            <div class="meta">
                <span class="size">${FileTransfer.formatSize(size)}</span>
                <span class="direction">${direction === 'upload' ? 'Sending' : 'Receiving'}</span>
            </div>
            <div class="progress-bar">
                <div class="fill" style="width: 0%"></div>
            </div>
        `;

        elements.transferList.appendChild(item);
    }

    // UI: Update transfer progress
    function updateTransferProgress(name, progress, direction) {
        const id = `transfer-${direction}-${name.replace(/[^a-z0-9]/gi, '-')}`;
        const item = document.getElementById(id);
        if (item) {
            const fill = item.querySelector('.fill');
            fill.style.width = progress + '%';
        }
    }

    // UI: Mark transfer complete
    function markTransferComplete(name, direction) {
        const id = `transfer-${direction}-${name.replace(/[^a-z0-9]/gi, '-')}`;
        const item = document.getElementById(id);
        if (item) {
            item.classList.add('complete');
            const fill = item.querySelector('.fill');
            fill.style.width = '100%';
            const directionSpan = item.querySelector('.direction');
            directionSpan.textContent = direction === 'upload' ? 'Sent' : 'Received';
        }
    }

    // Utility: Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Start
    init();
})();
