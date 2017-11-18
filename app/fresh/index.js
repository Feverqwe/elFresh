const debug = require('debug')('fresh');
const {app} = require('electron');
const fs = require('fs');
const path = require('path');
const compareVersions = require('compare-versions');

let crypto = null;
const getCrypto = function () {
  return crypto || (crypto = require('crypto'));
};

let fsfs = null;
const getFsfs = function () {
  return fsfs || (fsfs = require('fs-extra/lib/fs'));
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

  /**
   * @return {string}
   */
  get bundlePath() {
    const self = this;
    return self._bundle && self._bundle.path || '';
  }

  /**
   * @return {string}
   */
  get bundleVersion() {
    const self = this;
    return self._bundle && self._bundle.meta.version || '';
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
      return getFsfs().writeFile(self._configFilename, JSON.stringify(self._config));
    });
  }

  /**
   * @return {FreshBundle|null}
   */
  _getBundle() {
    const self = this;
    let bundle = null;

    let fallbackBundle = null;
    try {
      fallbackBundle = self._loadBundle(self._fallbackBundlePath, true);
    } catch (err) {
      debug('load local bundle error', err.message);
    }

    if (!bundle) {
      const version = self._config.bundleVersion;
      if (version) {
        if (!fallbackBundle || compareVersions(version, fallbackBundle.meta.version) > 0) {
          try {
            bundle = self._loadBundle(path.join(self._bundlesPath, version));
          } catch (err) {
            debug('load user bundle error', version, err.message);
          }
        }
      }
    }

    if (!bundle) {
      const files = [];
      try {
        files.push.apply(files, fs.readdirSync(self._bundlesPath));
      } catch (err) {}
      files.sort(compareVersions);
      files.reverse();
      files.some(function (version) {
        if (!fallbackBundle || compareVersions(version, fallbackBundle.meta.version) > 0) {
          try {
            bundle = self._loadBundle(path.join(self._bundlesPath, version));
            return true;
          } catch (err) {
            debug('load preview user bundle error', version, err.message);
          }
        }
      });
    }

    if (fallbackBundle) {
      if (!bundle || compareVersions(fallbackBundle.meta.version, bundle.meta.version) >= 0) {
        bundle = fallbackBundle;
      }
    }

    if (bundle) {
      debug('Loaded bundle', bundle.path);
    } else {
      debug('Bundle is not loaded');
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
    if (!meta.version || !meta.background.scripts.length) {
      throw new Error('Meta is incorrect');
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
          const sha256 = getCrypto().createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
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

  /**
   * @param {function} [_require]
   */
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