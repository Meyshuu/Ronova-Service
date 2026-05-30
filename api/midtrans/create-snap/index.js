const { createSnapHandler } = require('./handler');

module.exports = async function handler(req, res) {
  return createSnapHandler(req, res);
};


