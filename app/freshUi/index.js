const debug = require('debug')('freshUi');
const url = require('url');
const path = require('path');
const {BrowserWindow, ipcMain, app} = require('electron');

class Dialog {
  constructor(/**Fresh*/fresh) {
    this.fresh = fresh;

    this.win = null;

    this.handleMessage = this.handleMessage.bind(this);
    this.handleState = this.handleState.bind(this);
    this.handleDownloadingProgress = this.handleDownloadingProgress.bind(this);

    this.init();
    this.onCreate();

    /*this.win.webContents.openDevTools({
      mode: 'detach'
    });*/
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
    self.fresh.updater.on('state', self.handleState);
    self.fresh.updater.on('downloading-progress', self.handleDownloadingProgress);
  }
  onDestroy() {
    const self = this;
    ipcMain.removeListener('fresh-dialog', self.handleMessage);
    self.fresh.updater.removeListener('state', self.handleState);
    self.fresh.updater.removeListener('downloading-progress', self.handleDownloadingProgress);
  }
  sendMessage(msg) {
    const self = this;
    self.win && self.win.webContents.send('fresh-dialog', msg);
  }
  handleState(state) {
    const self = this;
    self.sendMessage({
      type: 'state',
      state: state
    });
  }
  handleDownloadingProgress(progress) {
    const self = this;
    self.sendMessage({
      type: 'downloading-progress',
      progress: progress
    });
  }
  handleMessage(event, msg) {
    const self = this;
    const winWebContents = self.win && self.win.webContents;
    if (event.sender.webContents !== winWebContents) {
      return;
    }

    switch (msg.action) {
      case 'getStateSync': {
        event.returnValue = self.fresh.updater.state;
        break;
      }
      case 'update': {
        self.fresh.updater.checkForUpdates();
        break;
      }
      case 'relaunch': {
        self.fresh.updater.quitAndInstall();
        break;
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