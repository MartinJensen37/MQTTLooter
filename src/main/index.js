const { app, BrowserWindow } = require('electron');
const path = require('path');
const WindowManager = require('./window-manager');
const { setupMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc-handlers');

class MQTTLooterApp {
    constructor() {
        this.windowManager = new WindowManager();
        this.setupEventHandlers();
    }

    setupEventHandlers() {
        app.whenReady().then(() => {
            this.initialize();
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.windowManager.createMainWindow();
            }
        });
    }

    async initialize() {
        setupMenu();
        registerIpcHandlers();
        await this.windowManager.createMainWindow();
    }
}

new MQTTLooterApp();