const { BrowserWindow } = require('electron');
const path = require('path');

class WindowManager {
    constructor() {
        this.mainWindow = null;
    }

    async createMainWindow() {
        this.mainWindow = new BrowserWindow({
            width: 1400,
            height: 900,
            minWidth: 800,
            minHeight: 600,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: false,
                // Remove preload since we're using nodeIntegration
                // preload: path.join(__dirname, '../preload/preload.js')
            },
            icon: path.join(__dirname, '../../assets/icon.ico')
        });

        await this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
        
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
        });

        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        return this.mainWindow;
    }

    getMainWindow() {
        return this.mainWindow;
    }
}

module.exports = WindowManager;