const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Comparte el contrato y la transformación de gráficos con el API.
config.watchFolders = [...config.watchFolders, path.resolve(__dirname, '../api/src')];
module.exports = config;
