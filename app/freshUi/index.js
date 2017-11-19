const debug = require('debug')('freshUi');
const url = require('url');
const path = require('path');
const {BrowserWindow, ipcMain, app} = require('electron');

class Dialog {
  constructor(fresh) {
    this.fresh = fresh;

    this.win = null;

    this.handleMessage = this.handleMessage.bind(this);
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleDownloadProgress = this.handleDownloadProgress.bind(this);

    this.init();
    this.onCreate();

    this.win.webContents.openDevTools({
      mode: 'detach'
    });
  }
  init() {
    const self = this;
    const win = new BrowserWindow({
      width: 400,
      height: 112,
      useContentSize: true,
      center: true,
      // closable: false,
      minimizable: false,
      maximizable: false,
      // resizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#ececec',
      title: 'Update'
    });

    self.win = win;

    win.loadURL(url.format({
      protocol: 'file',
      slashes: true,
      pathname: path.join(__dirname, '/dialog/index.html')
    }));

    win.on('closed', function () {
      self.win = null;
      self.destroy();
    });
  }
  onCreate() {
    const self = this;
    ipcMain.on('fresh-dialog', self.handleMessage);
    self.fresh.updater.on('stateChange', self.handleStateChange);
    self.fresh.updater.on('downloadProgress', self.handleDownloadProgress);
  }
  onDestroy() {
    const self = this;
    ipcMain.removeListener('fresh-dialog', self.handleMessage);
    self.fresh.updater.removeListener('stateChange', self.handleStateChange);
    self.fresh.updater.removeListener('downloadProgress', self.handleDownloadProgress);
  }
  sendMessage(msg) {
    const self = this;
    self.win && self.win.webContents.send('fresh-dialog', msg);
  }
  handleStateChange(state) {
    const self = this;
    self.sendMessage({
      type: 'state',
      state: state
    });
  }
  handleDownloadProgress(progress) {
    const self = this;
    self.sendMessage({
      type: 'downloadProgress',
      progress: progress
    });
  }
  handleMessage(event, msg) {
    const self = this;
    if (event.sender.webContents !== self.win.webContents) {
      return;
    }

    switch (msg.action) {
      case 'getStateSync': {
        event.returnValue = self.fresh.updater.state;
        return;
      }
      case 'update': {
        return self.fresh.updater.update().catch(function (err) {
          debug('Update error', err);
        });
      }
      case 'relaunch': {
        app.relaunch({args: process.argv.slice(1).concat(['--relaunch'])});
        app.exit(0);
      }
    }
  }
  destroy() {
    const self = this;
    if (self.win) {
      self.win.destroy();
    } else {
      self.onDestroy();
    }
  }
}

module.exports = Dialog;