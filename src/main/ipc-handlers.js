const { ipcMain } = require('electron');

function registerIpcHandlers() {
    // Store/retrieve connections from a more secure storage if needed
    ipcMain.handle('store-connections', async (event, connections) => {
        // Could implement secure storage here
        return true;
    });

    ipcMain.handle('load-connections', async (event) => {
        // Could implement secure storage retrieval here
        return {};
    });

    // Add more IPC handlers as needed
    ipcMain.handle('get-app-version', async (event) => {
        return require('../../package.json').version;
    });
}

module.exports = { registerIpcHandlers };