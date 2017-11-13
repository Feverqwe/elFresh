const path = require('path');
const url = require('url');
const {BrowserWindow} = require('electron');
const {app} = require('electron');

let uiWin = null;

new Promise(resolve => app.on('ready', resolve)).then(function () {
  uiWin = new BrowserWindow({});
  uiWin.loadURL(url.format({
    protocol: 'file',
    slashes: true,
    pathname: path.join(global.fresh.bundlePath, 'index.html')
  }));
  uiWin.webContents.openDevTools({
    mode: 'detach'
  });
});