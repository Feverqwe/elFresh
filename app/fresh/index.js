const debug = require('debug')('fresh');
const {app} = require('electron');
const fs = require('fs');
const fsp = require('./fsp');
const path = require('path');

let compareVersion = null;
const getCompareVersion = function () {
  return compareVersion || (compareVersion = require('compare-versions'));
};

let crypto = null;
const getCrypto = function () {
  return crypto || (crypto = require('crypto'));
};

let fsMkdirs = null;
const getFsMkdirs = function () {
  return fsMkdirs || (fsMkdirs = require('fs-extra/lib/mkdirs'));
};

/**
 * @typedef {{}} FreshConfig
 * @property {string} id
 * @property {string} fallbackBundlePath
 * @property {string} updateUrl
 * @property {number} autoUpdateDelay
 * @property {number} autoUpdateInterval
 */

/**
 * @typedef {{}} FreshBundle
 * @property {string} path
 * @property {FreshBundleMeta} meta
 */

/**
 * @typedef {{}} FreshBundleMeta
 * @property {string} version
 * @property {{}} background
 * @property {string[]} background.scripts
 */

/**
 * @typedef {{}} FreshVerify
 * @property {string} packageHash
 * @property {FreshVerifyFile[]} _files
 */

/**
 * @typedef {{}} FreshVerifyFile
 * @property {string} path
 * @property {number} size
 * @property {string} etag
 * @property {string} sha256
 */

class Fresh {
  constructor(/**FreshConfig*/pkgConfig, /**string*/rootPath) {
    const self = this;
    self.id = pkgConfig.id;
    self.version = '1.0';
    self._pkgConfig = pkgConfig;
    self._freshPath = path.join(app.getPath('userData'), 'fresh', pkgConfig.id);
    self._configFilename = path.join(self._freshPath, 'config.json');
    self._fallbackBundlePath = path.join(rootPath, pkgConfig.fallbackBundlePath);
    self._bundlesPath = path.join(self._freshPath, 'bundles');
    self._config = {
      lastUpdate: 0,
      bundleVersion: ''
    };
    self._loadConfig();
    self._bundle = self._getBundle();
    self._updater = null;
    self._autoUpdate();
  }

  get bundlePath() {
    const self = this;
    return self._bundle && self._bundle.path || '';
  }

  /**
   * @return {Promise}
   */
  _autoUpdate() {
    const self = this;
    return new Promise(resolve => setTimeout(resolve, self._pkgConfig.autoUpdateDelay)).then(function () {
      const now = parseInt(Date.now() / 1000);
      if (
        typeof self._config.lastUpdate !== 'number' ||
        self._config.lastUpdate > now
      ) {
        self._config.lastUpdate = 0;
      }
      if (self._config.lastUpdate + self._pkgConfig.autoUpdateInterval < now) {
        self._config.lastUpdate = now;
        return self.updater.update().then(function () {
          return self._saveConfig();
        });
      }
    }).catch(function (err) {
      debug('autoUpdate error', err);
    });
  }

  _loadConfig() {
    const self = this;
    try {
      Object.assign(self._config, JSON.parse(fs.readFileSync(self._configFilename)));
    } catch (err) {}
  }

  /**
   * @return {Promise}
   */
  _saveConfig() {
    const self = this;
    return getFsMkdirs().ensureDir(self._freshPath).then(function () {
      return fsp.writeFile(self._configFilename, JSON.stringify(self._config));
    });
  }

  /**
   * @return {FreshBundle|null}
   */
  _getBundle() {
    const self = this;
    let bundle = null;
    if (!bundle) {
      try {
        if (!self._config.bundleVersion) {
          throw new Error('bundleVersion is empty');
        }
        bundle = self._loadBundle(path.join(self._bundlesPath, self._config.bundleVersion));
      } catch (err) {
        debug('load user bundle error', self._config.bundleVersion, err.message);
      }
    }
    if (!bundle) {
      try {
        const files = fs.readdirSync(self._bundlesPath);
        files.sort(getCompareVersion());
        files.reverse();
        files.some(function (name) {
          try {
            bundle = self._loadBundle(path.join(self._bundlesPath, name));
            return true;
          } catch (err) {
            debug('load preview user bundle error', name, err.message);
          }
        });
      } catch (err) {
        debug('find preview user bundles error', err.message);
      }
    }
    if (!bundle) {
      try {
        bundle = self._loadBundle(self._fallbackBundlePath, true);
      } catch (err) {
        debug('load local bundle error', err.message);
      }
    }
    return bundle;
  }

  /**
   * @param {string} bundlePath
   * @param {boolean} [skipVerify]
   * @return {FreshBundle}
   */
  _loadBundle(bundlePath, skipVerify) {
    const self = this;
    /**@type {FreshBundleMeta}*/
    const meta = JSON.parse(fs.readFileSync(path.join(bundlePath, 'meta.json')));
    if (!skipVerify) {
      self._verifyBundle(bundlePath);
    }
    return {
      path: bundlePath,
      meta: meta
    };
  }

  /**
   * @param {string} bundlePath
   * @param {string} [packageHash]
   */
  _verifyBundle(bundlePath, packageHash) {
    const self = this;
    const verifyFilename = path.join(bundlePath, '_verify.json');
    /**@type {FreshVerify}*/
    const verify = JSON.parse(fs.readFileSync(verifyFilename));
    if (packageHash && verify.packageHash !== packageHash) {
      throw new Error('Package hash is incorrect');
    }
    let saveVerify = false;
    verify._files.forEach(function (file) {
      const filename = path.join(bundlePath, file.path);
      const stat = fs.statSync(filename);
      const etag = self._getETag(stat);
      if (file.etag !== etag) {
        if (file.size !== stat.size) {
          throw new Error('File size is incorrect');
        }
        if (stat.size < 10 * 1024 * 1024) {
          let sha256 = getCrypto().createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
          if (file.sha256 !== sha256) {
            throw new Error('File hash is incorrect');
          }
        }
        file.etag = etag;
        saveVerify = true;
      }
    });
    if (saveVerify) {
      fs.writeFileSync(verifyFilename, JSON.stringify(verify));
    }
  }

  startBundle(_require = require) {
    const self = this;
    const bundle = self._bundle;
    if (bundle) {
      bundle.meta.background.scripts.forEach(function (script) {
        _require(path.join(bundle.path, script));
      });
    }
  }

  /**
   * @return {Updater}
   */
  get updater() {
    const self = this;
    if (!self._updater) {
      const Updater = require('./updater');
      self._updater = new Updater(self);
    }
    return self._updater;
  }

  /**
   * @param {Object} stat
   * @return {string}
   */
  _getETag(stat) {
    const mtime = stat.mtime.getTime().toString(16);
    const size = stat.size.toString(16);

    return size + '-' + mtime
  }
}

module.exports = Fresh;