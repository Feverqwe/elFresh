const Fresh = require('./fresh');

global.fresh = new Fresh(require('./fresh.config.json'), __dirname);

global.fresh.startBundle(require);