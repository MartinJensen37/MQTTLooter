const { Menu, shell } = require('electron');

function setupMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Connection',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        // Send IPC to renderer to show new connection modal
                        const focusedWindow = require('electron').BrowserWindow.getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.send('menu-new-connection');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Quit',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        require('electron').app.quit();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About MQTTLooter',
                    click: () => {
                        shell.openExternal('https://github.com/martinjensen37/mqttlooter');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

module.exports = { setupMenu };