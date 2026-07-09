// Webpack 4 hashes modules with MD4, which OpenSSL 3 (Node 17+) removed.
// Fall back to SHA-256 whenever the requested algorithm is unavailable, so
// the project builds on any Node version without --openssl-legacy-provider.
const crypto = require("crypto");
const original_create_hash = crypto.createHash;
crypto.createHash = (algorithm, options) => {
  try {
    return original_create_hash(algorithm, options);
  } catch (e) {
    return original_create_hash("sha256", options);
  }
};

module.exports = {
  chainWebpack: config => config.resolve.symlinks(false)
};
