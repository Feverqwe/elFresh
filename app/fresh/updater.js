const debug = require('debug')('fresh:updater');
const path = require('path');
const qs = require('querystring');
const popsicle = require('popsicle');
const compareVersions = require('compare-versions');
const crypto = require('crypto');
const unzip = require('unzip');
const fsfs = require('fs-extra/lib/fs');
const fsRemove = require('fs-extra/lib/remove');
const fsMkdirs = require('fs-extra/lib/mkdirs');
const {EventEmitter} = require('events');
const appVersion = require('electron').app.getVersion();

/**
 * @typedef {{}} FreshBundleUpdate
 * @property {Object.<string,FreshBundleUpdateInfo>} app
 */

/**
 * @typedef {{}} FreshBundleUpdateInfo
 * @property {string} url
 * @property {string} sha256
 * @property {string} version
 */

/**
 * @typedef {{}} FreshFipFile
 * @property {string} path
 * @property {number} size
 * @property {string} sha256
 */

class Updater extends EventEmitter {
  constructor(/**Fresh*/fresh) {
    super();
    const self = this;
    self._fresh = fresh;
    self._tmpPath = path.join(fresh._freshPath, 'tmp');
    self._updatePromise = null;

    self.STATE_IDLE = 0;
    self.STATE_CHECKING_FOR_UPDATE = 1;
    self.STATE_UPDATE_AVAILABLE = 2;
    self.STATE_UPDATE_DOWNLOADED = 3;
    self.STATE_UPDATE_NOT_AVAILABLE = 4;
    self.STATE_ERROR = 5;

    self._state = self.STATE_IDLE;
  }

  /**
   * @param {number} state
   */
  set state(state) {
    const self = this;
    self._state = state;
    self.emit('stateChange', self._state);
  }

  /**
   * @return {number}
   */
  get state() {
    const self = this;
    return self._state;
  }

  /**
   * @return {Promise.<FreshBundleUpdateInfo|null>}
   */
  update() {
    const self = this;
    if (self._updatePromise) {
      return self._updatePromise;
    } else {
      return self._updatePromise = self._update().then(function (result) {
        self._updatePromise = null;
        return result;
      });
    }
  }

  /**
   * @return {Promise.<FreshBundleUpdateInfo|null>}
   */
  _update() {
    const self = this;
    self.state = self.STATE_CHECKING_FOR_UPDATE;
    return self._checkUpdate(self._fresh._pkgConfig, self._fresh.bundleVersion).then(function (updateInfo) {
      if (!updateInfo) {
        self.state = self.STATE_UPDATE_NOT_AVAILABLE;
        return null;
      }
      self.state = self.STATE_UPDATE_AVAILABLE;
      const bundlePath = path.join(self._fresh._bundlesPath, updateInfo.version);
      return self._checkBundle(updateInfo, bundlePath).catch(function (err) {
        return self._downloadUpdate(updateInfo).then(function (filename) {
          return self._extractAndReadZip(filename, bundlePath).then(function (files) {
            return self._writeVerify(files, bundlePath, updateInfo.sha256);
          }).then(function () {
            return fsfs.unlink(filename);
          });
        }).then(function () {
          self._fresh._config.bundleVersion = updateInfo.version;
          return self._fresh._saveConfig();
        }).then(function () {
          return self._clearBundles([updateInfo.version, self._fresh.bundleVersion]);
        });
      }).then(function () {
        self.state = self.STATE_UPDATE_DOWNLOADED;
        return updateInfo;
      });
    }).catch(function (err) {
      self.state = self.STATE_ERROR;
      throw err;
    });
  }

  /**
   * @param {FreshConfig} pkgConfig
   * @param {string} bundleVersion
   * @return {Promise.<FreshBundleUpdateInfo|null>}
   */
  _checkUpdate(pkgConfig, bundleVersion) {
    const self = this;
    return popsicle.get(pkgConfig.updateUrl + '?' + qs.stringify({
      id: self._fresh.id,
      appVersion: appVersion,
      bundleVersion: bundleVersion,
      freshVersion: self._fresh.version
    })).then(function (res) {
      if (res.status !== 200) {
        throw new Error("Bad status");
      }
      /**@type FreshBundleUpdate*/
      const meta = JSON.parse(res.body);
      const updateInfo = meta.app[pkgConfig.id];
      if (!updateInfo) {
        throw new Error('Package id is not found!');
      }
      if (!bundleVersion || compareVersions(updateInfo.version, bundleVersion) > 0) {
        return updateInfo;
      }
    });
  }

  /**
   * @param {FreshBundleUpdateInfo} updateInfo
   * @param {string} bundlePath
   * @return {Promise.<boolean>}
   */
  _checkBundle(updateInfo, bundlePath) {
    const self = this;
    return Promise.resolve().then(function () {
      if (self._fresh._config.bundleVersion !== updateInfo.version) {
        throw new Error('bundleVersion is not equal');
      }
      self._fresh._verifyBundle(bundlePath, updateInfo.sha256);
    });
  }

  /**
   * @param {FreshBundleUpdateInfo} updateInfo
   * @return {Promise.<string>}
   */
  _downloadUpdate(updateInfo) {
    const self = this;
    const url = updateInfo.url;
    const sha256 = updateInfo.sha256;
    const name = `bundle_${updateInfo.version}.zip`;
    const filename = path.join(self._tmpPath, name);
    const tmpFilename = filename + '.tmp';

    return fsMkdirs.ensureDir(self._tmpPath).then(function () {
      return fsfs.access(filename).catch(function () {
        return self._tryContinue(url, tmpFilename).then(function () {
          return fsfs.rename(tmpFilename, filename);
        });
      });
    }).then(function () {
      return self._compareHash(filename, 'sha256', sha256).catch(function (err) {
        return fsfs.unlink(filename).then(function () {
          throw err;
        });
      });
    }).then(function () {
      return filename;
    });
  }

  /**
   * @param {string} filename
   * @param {string} alg
   * @param {string} hash
   * @return {Promise}
   */
  _compareHash(filename, alg, hash) {
    const self = this;
    return self._getHash(filename, alg).then(function (fileHash) {
      if (fileHash !== hash) {
        throw new Error('Hash is incorrect');
      }
    });
  }

  /**
   * @param {string} filename
   * @param {string} alg
   * @return {Promise.<string>}
   */
  _getHash(filename, alg) {
    const self = this;
    return self._getStreamHash(fsfs.createReadStream(filename), alg);
  }

  /**
   * @param {Readable} stream
   * @param {string} alg
   * @return {Promise.<string>}
   */
  _getStreamHash(stream, alg) {
    return new Promise(function (resolve, reject) {
      stream
        .pipe(crypto.createHash(alg).setEncoding('hex'))
        .on('error', function (err) {
          reject(err);
        })
        .on('finish', function () {
          resolve(this.read());
        });
    });
  }

  /**
   * @param {string} url
   * @param {string} filename
   * @return {Promise}
   */
  _tryContinue(url, filename) {
    const self = this;
    let retryCount = 10;
    const tryContinue = function () {
      return fsfs.stat(filename).then(function (stat) {
        return self._downloadFile(url, filename, stat).catch(function (err) {
          if (err.res && err.res.status === 416) {
            debug('Unable to resume download!', err);
            return self._downloadFile(url, filename);
          }
          throw err;
        });
      }, function () {
        return self._downloadFile(url, filename);
      }).catch(function (err) {
        if (retryCount-- > 0) {
          if (['ECONNRESET', 'ETIMEDOUT', 'FILE_IS_NOT_FULL'].indexOf(err.code) !== -1) {
            debug('Retry downloading', url, err);
            return new Promise(function(resolve) {
              setTimeout(resolve, 250);
            }).then(tryContinue);
          }
        }

        throw err;
      });
    };
    return tryContinue();
  }

  /**
   * @param {string} url
   * @param {string} filename
   * @param {Object} [stat]
   * @return {Promise}
   */
  _downloadFile(url, filename, stat) {
    const self = this;

    let headers = {};
    if (stat) {
      headers['Range'] = 'bytes=' + stat.size + '-';
    }

    const request = popsicle.request({
      method: 'GET',
      url: url,
      headers: headers,
      transport: popsicle.createTransport({ type: 'stream' })
    });
    request.on('progress', function () {
      self.emit('downloadProgress', {
        downloadedBytes: request.downloadedBytes,
        downloadLength: request.downloadLength,
        downloaded: request.downloaded,
        completed: request.completed
      });
    });
    return request.then(function (res) {
      const successStatus = stat ? 206 : 200;
      if (res.status !== successStatus) {
        request.abort();
        const err = new Error('Bad status');
        err.res = res;
        throw err;
      }

      res.body.pause();

      return new Promise(function (resolve, reject) {
        const options = {};
        if (res.status === 200) {
          options.flags = 'w';
        } else
        if (res.status === 206) {
          options.flags = 'a';
        }

        res.body
          .on('error', function (err) {
            reject(err);
          })
          .pipe(fsfs.createWriteStream(filename, options))
          .on('error', function (err) {
            reject(err);
          })
          .on('finish', function () {
            if (request.downloadedBytes !== request.downloadLength) {
              const err = new Error('File size is not full');
              err.res = res;
              err.code = 'FILE_IS_NOT_FULL';
              reject(err);
            } else {
              resolve();
            }
          });

        res.body.resume();
      });
    });
  }

  /**
   * @param {string} filename
   * @param {string} extractPath
   * @return {Promise.<FreshFipFile[]>}
   */
  _extractAndReadZip(filename, extractPath) {
    const self = this;
    return fsRemove.remove(extractPath).then(function () {
      return fsMkdirs.ensureDir(extractPath);
    }).then(function () {
      const stream = fsfs.createReadStream(filename);
      return Promise.all([
        self._getZipFiles(stream),
        self._extractZip(stream, extractPath)
      ]).then(function (results) {
        return results[0];
      });
    });
  }

  /**
   * @param {Readable} stream
   * @return {Promise.<FreshFipFile[]>}
   */
  _getZipFiles(stream) {
    const self = this;
    return new Promise(function (resolve, reject) {
      const files = [];
      return stream
        .pipe(unzip.Parse())
        .on('entry', function (entry) {
          if (entry.type === 'File') {
            const promise = self._getStreamHash(entry, 'sha256')
              .then(function (sha256) {
                return {
                  path: entry.path,
                  size: entry.size,
                  sha256: sha256
                };
              });
            files.push(promise);
          } else {
            entry.autodrain();
          }
        }).on('error', function (err) {
          reject(err);
        }).on('close', function () {
          resolve(Promise.all(files));
        });
    });
  }

  /**
   * @param {Readable} stream
   * @param {string} extractPath
   * @return {Promise}
   */
  _extractZip(stream, extractPath) {
    const self = this;
    return new Promise(function (resolve, reject) {
      return stream
        .pipe(unzip.Extract({
          path: extractPath
        })).on('error', function (err) {
          reject(err);
        }).on('close', function () {
          resolve();
        });
    });
  }

  /**
   * @param {FreshFipFile[]} files
   * @param {string} extractPath
   * @param {string} packageHash
   * @return {Promise}
   */
  _writeVerify(files, extractPath, packageHash) {
    const self = this;
    const _files = [];
    let promise = Promise.resolve();
    files.forEach(function (file) {
      promise = promise.then(function () {
        const filename = path.join(extractPath, file.path);
        return Promise.all([
          fsfs.stat(filename),
          self._getHash(filename, 'sha256')
        ]).then(function (results) {
          const [stat, sha256] = results;
          if (sha256 !== file.sha256 || stat.size !== file.size) {
            throw new Error('Extracted file is broken');
          }
          file.etag = self._fresh._getETag(stat);
          _files.push(file);
        });
      });
    });
    return promise.then(function () {
      const verify = {
        packageHash: packageHash,
        _files: _files
      };
      return fsfs.writeFile(path.join(extractPath, '_verify.json'), JSON.stringify(verify));
    }).catch(function (err) {
      debug('_writeVerify error', err);
      throw err;
    });
  }

  /**
   * @param {string[]} exclude
   * @return {Promise}
   */
  _clearBundles(exclude) {
    const self = this;
    const bundlesPath = self._fresh._bundlesPath;
    return fsfs.readdir(bundlesPath).then(function (files) {
      files = files.filter(self._fresh._isValidVersion);
      files.sort(compareVersions);
      files.reverse();
      return Promise.all(files.slice(3).map(function (name) {
        if (exclude.indexOf(name) === -1) {
          const filename = path.join(bundlesPath, name);
          return fsRemove.remove(filename);
        }
      }));
    }).catch(function (err) {
      debug('_clearBundles error', err);
    });
  }
}

module.exports = Updater;