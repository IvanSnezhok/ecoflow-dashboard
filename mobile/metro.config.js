// The app shares types, the device store and pure helpers with the web panel (../src,
// imported as "@panel/..."). Those files sit outside this project, so Metro watches
// them and resolves their packages (zustand, react) from this project's node_modules
// only: a second copy of React from the panel's node_modules would break hooks.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const panelSrc = path.resolve(__dirname, '../src');
const config = getDefaultConfig(__dirname);

config.watchFolders = [panelSrc];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName.startsWith('@panel/')) {
    return resolve(context, path.join(panelSrc, moduleName.slice('@panel/'.length)), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
