const fs = require('fs');
const path = require('path');
const popsicle = require('popsicle');
const compareVersion = require('compare-versions');
const fsp = require('./fsp');
const crypto = require('crypto');
const unzip = require('unzip');
const fsRemove = require('fs-extra/lib/remove');
const fsMove = require('fs-extra/lib/move');
const fsMkdirs = require('fs-extra/lib/mkdirs');

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

class Updater {
  constructor(/**Fresh*/fresh) {
    const self = this;
    self._fresh = fresh;
    self._tmpPath = path.join(fresh._freshPath, 'tmp');
  }

  /**
   * @return {Promise}
   */
  update() {
    const self = this;
    return self._checkUpdate(self._fresh._pkgConfig, self._fresh._bundle).then(function (updateInfo) {
      if (!updateInfo) return;
      const bundlePath = path.join(self._fresh._bundlesPath, updateInfo.version);
      const extractPath = path.join(self._fresh._freshPath, 'tmp', 'bundle_' + updateInfo.version);
      return self._checkBundle(updateInfo, bundlePath).catch(function (err) {
        return self._downloadUpdate(updateInfo).then(function (filename) {
          return self._extractAndReadZip(filename, extractPath).then(function (files) {
            return fsp.unlink(filename).then(function () {
              return self._setLastBundle(extractPath, bundlePath);
            }).then(function () {
              return self._writeVerify(files, bundlePath);
            });
          });
        }).then(function () {
          self._fresh._config.bundleVersion = updateInfo.version;
          return self._fresh._saveConfig();
        }).then(function () {
          return self._clearBundles(updateInfo.version);
        });
      });
    }).catch(function (err) {
      console.error('update error', err);
    });
  }

  /**
   * @param {FreshConfig} pkgConfig
   * @param {FreshBundle|null} bundle
   * @return {Promise.<FreshBundleUpdateInfo|null>}
   */
  _checkUpdate(pkgConfig, bundle) {
    const self = this;
    return popsicle.get(pkgConfig.updateUrl).then(function (res) {
      if (res.status !== 200) {
        throw new Error("Bad status");
      }
      /**@type FreshBundleUpdate*/
      const meta = JSON.parse(res.body);
      const updateInfo = meta.app[pkgConfig.id];
      if (!bundle || compareVersion(updateInfo.version, bundle.meta.version) > 0) {
        return updateInfo;
      }
    }).catch(function (err) {
      console.error('checkUpdate error', err);
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
      self._fresh._verifyBundle(bundlePath);
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
      return fsp.access(filename).catch(function () {
        return self._tryContinue(url, tmpFilename).then(function () {
          return fsp.rename(tmpFilename, filename);
        });
      });
    }).then(function () {
      return self._compareHash(filename, 'sha256', sha256).catch(function (err) {
        return fsp.unlink(filename).then(function () {
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
    return new Promise(function (resolve, reject) {
      fs.createReadStream(filename)
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
      return fsp.stat(filename).then(function (stat) {
        return self._downloadFile(url, filename, stat).catch(function (err) {
          if (err.res && err.res.status === 416) {
            console.error('Unable to resume download!', err);
            return self._downloadFile(url, filename);
          }
          throw err;
        });
      }, function () {
        return self._downloadFile(url, filename);
      }).catch(function (err) {
        if (retryCount-- > 0) {
          if (['ECONNRESET', 'ETIMEDOUT'].indexOf(err.code) !== -1) {
            console.error('Retry downloading', url, err);
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
    let stream = null;

    let headers = {};
    if (stat) {
      headers['Range'] = 'bytes=' + stat.size + '-';
    }

    return popsicle.request({
      method: 'GET',
      url: url,
      headers: headers,
      transport: popsicle.createTransport({ type: 'stream' })
    }).then(function (res) {
      if (
        (stat && res.status !== 206) ||
        (!stat && res.status !== 200)
      ) {
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

        stream = res.body.pipe(fs.createWriteStream(filename, options))
          .on('error', function (err) {
            reject(err);
          })
          .on('finish', function () {
            resolve();
          });

        res.body.resume();
      });
    }).catch(function (err) {
      if (stream) {
        stream.destroy(err);
      }
      throw err;
    });
  }

  /**
   * @param {string} filename
   * @param {string} extractPath
   * @return {Promise.<string[]>}
   */
  _extractAndReadZip(filename, extractPath) {
    const self = this;
    return fsRemove.remove(extractPath).then(function () {
      return fsMkdirs.ensureDir(extractPath);
    }).then(function () {
      const stream = fs.createReadStream(filename);
      return Promise.all([
        self._getZipFiles(stream),
        self._extractZip(stream, extractPath)
      ]).then(function (results) {
        return results[0];
      });
    });
  }

  /**
   * @param {Object} stream
   * @return {Promise.<string[]>}
   */
  _getZipFiles(stream) {
    return new Promise(function (resolve, reject) {
      const files = [];
      return stream
        .pipe(unzip.Parse())
        .on('entry', function (entry) {
          if (entry.type === 'File') {
            files.push(entry.path);
          }
          entry.autodrain();
        }).on('error', function (err) {
          reject(err);
        }).on('close', function () {
          resolve(files);
        });
    });
  }

  /**
   * @param {Object} stream
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
   * @param {string[]} files
   * @param {string} extractPath
   * @return {Promise}
   */
  _writeVerify(files, extractPath) {
    const self = this;
    const _files = [];
    let promise = Promise.resolve();
    files.forEach(function (name) {
      promise = promise.then(function () {
        const filename = path.join(extractPath, name);
        return Promise.all([
          fsp.stat(filename),
          self._getHash(filename, 'sha256')
        ]).then(function (results) {
          const [stat, sha256] = results;
          _files.push({
            path: name,
            size: stat.size,
            etag: self._fresh._getETag(stat),
            sha256: sha256
          });
        });
      });
    });
    return promise.then(function () {
      const verify = {
        _files: _files
      };
      return fsp.writeFile(path.join(extractPath, '_verify.json'), JSON.stringify(verify));
    }).catch(function (err) {
      console.error('_writeVerify error', err);
      throw err;
    });
  }

  /**
   * @param {string} extractPath
   * @param {string} bundlePath
   * @return {Promise}
   */
  _setLastBundle(extractPath, bundlePath) {
    return fsRemove.remove(bundlePath).then(function () {
      return fsMkdirs.ensureDir(bundlePath);
    }).then(function () {
      return fsMove.move(extractPath, bundlePath);
    });
  }

  /**
   * @param {string} currentVersion
   * @return {Promise}
   */
  _clearBundles(currentVersion) {
    const self = this;
    const bundlesPath = self._fresh._bundlesPath;
    return fsp.readdir(bundlesPath).then(function (files) {
      files.sort(compareVersion);
      files.reverse();
      return Promise.all(files.slice(3).map(function (name) {
        if (name !== currentVersion) {
          const filename = path.join(bundlesPath, name);
          return fsRemove.remove(filename);
        }
      }));
    }).catch(function (err) {
      console.error('_clearBundles error', err);
    });
  }
}

module.exports = Updater;