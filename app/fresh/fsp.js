const fs = require('fs');

const fsp = {
  access: function (...args) {return this._inPromise('access', args)},
  stat: function (...args) {return this._inPromise('stat', args)},
  readFile: function (...args) {return this._inPromise('readFile', args)},
  writeFile: function (...args) {return this._inPromise('writeFile', args)},
  readdir: function (...args) {return this._inPromise('readdir', args)},
  rename: function (...args) {return this._inPromise('rename', args)},
  unlink: function (...args) {return this._inPromise('unlink', args)},
  mkdir: function (...args) {return this._inPromise('mkdir', args)},
  _inPromise: function (method, args) {
    return new Promise(function (resolve, reject) {
      args.push((err, result) => err ? reject(err) : resolve(result));
      fs[method].apply(fs, args);
    });
  }
};

module.exports = fsp;