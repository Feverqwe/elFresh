const React = require('react');
const ReactDOM = require('react-dom');
const {ipcRenderer} = require('electron');

const STATE_IDLE = 0;
const STATE_CHECKING_FOR_UPDATE = 1;
const STATE_UPDATE_AVAILABLE = 2;
const STATE_UPDATE_DOWNLOADED = 3;
const STATE_UPDATE_NOT_AVAILABLE = 4;
const STATE_ERROR = 5;

class Dialog extends React.Component {
  constructor() {
    super();

    this.state = {
      state: STATE_IDLE
    };

    this.handleMessage = this.handleMessage.bind(this);
  }
  componentWillMount() {
    ipcRenderer.on('fresh-dialog', this.handleMessage);
    this.getState();
  }
  componentWillUnmount() {
    ipcRenderer.removeListener('fresh-dialog', this.handleMessage);
  }
  send(msg) {
    ipcRenderer.send('fresh-dialog', msg);
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
  handleMessage(event, msg) {
    switch (msg.type) {
      case 'state': {
        this.setState({
          state: msg.state
        });
        break;
      }
    }
  }
  render() {
    if (this.state.state === STATE_IDLE) {
      return (<DialogIdle dialog={this}/>);
    } else
    if (this.state.state === STATE_CHECKING_FOR_UPDATE) {
      return (<DialogCheckingForUpdate dialog={this}/>);
    } else
    if (this.state.state === STATE_UPDATE_AVAILABLE) {
      return (<DialogUpdateAvailable dialog={this}/>);
    } else
    if (this.state.state === STATE_UPDATE_DOWNLOADED) {
      return (<DialogUpdateDownloaded dialog={this}/>);
    } else
    if (this.state.state === STATE_UPDATE_NOT_AVAILABLE) {
      return (<DialogUpdateNotAvailable dialog={this}/>);
    } else
    if (this.state.state === STATE_ERROR) {
      return (<DialogError dialog={this}/>);
    }
  }
}

class DialogIdle extends React.Component {
  constructor(props) {
    super();

    this.dialog = props.dialog;

    this.handleUpdate = this.handleUpdate.bind(this);
  }
  handleUpdate() {
    this.dialog.update();
  }
  render() {
    return (
      <div className="dialog dialog-idle">
        <button onClick={this.handleUpdate}>Update</button>
      </div>
    );
  }
}

class DialogCheckingForUpdate extends React.Component {
  constructor(props) {
    super();

    this.dialog = props.dialog;
  }
  render() {
    return (
      <div className="dialog dialog-checking-for-update">
        checking for update
      </div>
    );
  }
}

class DialogUpdateAvailable extends React.Component {
  constructor(props) {
    super();

    this.dialog = props.dialog;
  }
  render() {
    return (
      <div className="dialog dialog-update-available">
        update available
      </div>
    );
  }
}

class DialogUpdateDownloaded extends React.Component {
  constructor(props) {
    super();

    this.dialog = props.dialog;
  }
  render() {
    return (
      <div className="dialog dialog-update-downloaded">
        update downloaded
      </div>
    );
  }
}

class DialogUpdateNotAvailable extends React.Component {
  constructor(props) {
    super();

    this.dialog = props.dialog;
  }
  render() {
    return (
      <div className="dialog dialog-update-not-available">
        update not available
      </div>
    );
  }
}

class DialogError extends React.Component {
  constructor(props) {
    super();

    this.dialog = props.dialog;
  }
  render() {
    return (
      <div className="dialog dialog-error">
        Error
      </div>
    );
  }
}

ReactDOM.render(React.createElement(Dialog), document.getElementById('root'));