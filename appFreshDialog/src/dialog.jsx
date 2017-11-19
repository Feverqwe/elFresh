const React = require('react');
const ReactDOM = require('react-dom');
const {ipcRenderer} = require('electron');
const prettyBytes = require('pretty-bytes');

const STATE_IDLE = 0;
const STATE_CHECKING_FOR_UPDATE = 1;
const STATE_UPDATE_AVAILABLE = 2;
const STATE_UPDATE_DOWNLOADED = 3;
const STATE_UPDATE_NOT_AVAILABLE = 4;
const STATE_ERROR = 5;

import bootstrapStyle from './bootstrap.css';
import dialogStyle from './dialog.css';

class DialogCtr extends React.Component {
  constructor() {
    super();

    this.state = {
      state: STATE_IDLE,
      percents: 0,
      downloadedBytes: 0,
      downloadLength: 0
    };

    this.handleMessage = this.handleMessage.bind(this);
    this.handleUpdate = this.handleUpdate.bind(this);
    this.handleRelaunch = this.handleRelaunch.bind(this);
    this.handleClose = this.handleClose.bind(this);
  }
  componentWillMount() {
    ipcRenderer.on('fresh-dialog', this.handleMessage);
    const state = this.getStateSync();
    this.state.state = state;
    if ([STATE_IDLE, STATE_ERROR, STATE_UPDATE_NOT_AVAILABLE].indexOf(state) !== -1) {
      this.update();
    }
  }
  componentWillUnmount() {
    ipcRenderer.removeListener('fresh-dialog', this.handleMessage);
  }
  send(msg) {
    ipcRenderer.send('fresh-dialog', msg);
  }
  sendSync(msg) {
    return ipcRenderer.sendSync('fresh-dialog', msg);
  }
  getStateSync() {
    return this.sendSync({
      action: 'getStateSync'
    });
  }
  getState() {
    this.send({
      action: 'getState'
    });
  }
  update() {
    this.send({
      action: 'update'
    });
  }
  relaunch() {
    this.send({
      action: 'relaunch'
    });
  }
  handleMessage(event, msg) {
    switch (msg.type) {
      case 'state': {
        this.setState({
          state: msg.state
        });
        break;
      }
      case 'downloadProgress': {
        const {downloadedBytes, downloadLength} = msg.progress;
        const percents = parseInt(100 / downloadLength * downloadedBytes);
        this.setState({
          percents: percents,
          downloadedBytes: downloadedBytes,
          downloadLength: downloadLength
        });
        break;
      }
    }
  }
  handleUpdate() {
    this.update();
  }
  handleRelaunch() {
    this.relaunch();
  }
  handleClose() {
    window.close();
  }
  render() {
    let options = {};
    if (this.state.state === STATE_IDLE) {
      options = {
        buttons: [
          {
            title: 'Update',
            onClick: this.handleUpdate
          }
        ]
      };
    }

    if (this.state.state === STATE_CHECKING_FOR_UPDATE) {
      options = {
        content: (
          <div>
            <div>
              Checking for update
            </div>
            <div>
              <progress/>
            </div>
          </div>
        )
      };
    } else
    if (this.state.state === STATE_UPDATE_AVAILABLE) {
      const {downloadedBytes, downloadLength} = this.state;

      let progress = '...';
      try {
        if (downloadLength) {
          progress = ` ${prettyBytes(downloadedBytes)} / ${prettyBytes(downloadLength)}`;
        }
      } catch (err) {}

      options = {
        content: (
          <div>
            <div>
              Downloading{progress}
            </div>
            <div>
              <progress value={this.state.percents} max="100"/>
            </div>
          </div>
        ),
      };
    } else
    if (this.state.state === STATE_UPDATE_DOWNLOADED) {
      options = {
        content: 'Update is ready',
        buttons: [
          {
            title: 'Relaunch',
            onClick: this.handleRelaunch
          },
          {
            title: 'Later',
            onClick: this.handleClose
          }
        ]
      };
    } else
    if (this.state.state === STATE_UPDATE_NOT_AVAILABLE) {
      options = {
        content: 'No update available',
        buttons: [
          {
            title: 'Close',
            onClick: this.handleClose
          }
        ]
      };
    } else
    if (this.state.state === STATE_ERROR) {
      options = {
        content: 'Error :(',
        buttons: [
          {
            title: 'Try again',
            onClick: this.handleUpdate
          },
          {
            title: 'Close',
            onClick: this.handleClose
          }
        ]
      };
    }
    return (
      <Dialog dialog={this} options={options}/>
    );
  }
}

class Dialog extends React.Component {
  render() {
    const options = this.props.options;
    const content = (
      <DialogContent>
        {options.content}
      </DialogContent>
    );
    const buttons = (
      <DialogButtons buttons={options.buttons}/>
    );
    return (
      <div className="dialog">
        {content}
        {buttons}
      </div>
    );
  };
}

class DialogContent extends React.Component {
  render() {
    const content = this.props.children;
    if (!content) {
      return null;
    }

    return (
      <div className="dialog-content">{content}</div>
    );
  }
}

class DialogButtons extends React.Component {
  render() {
    let buttons = this.props.buttons || [];
    if (!buttons.length) {
      return null;
    }

    buttons = this.props.buttons.map(function (item) {
      return (
        <div className="dialog-button">
          <button type="button" onClick={item.onClick}>{item.title}</button>
        </div>
      );
    });

    return (
      <div className="dialog-buttons-wrap">
        {buttons}
      </div>
    );
  }
}

ReactDOM.render(React.createElement(DialogCtr), document.getElementById('root'));