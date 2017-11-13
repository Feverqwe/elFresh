const {SourceMapDevToolPlugin} = require('webpack');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    appBg: './src'
  },
  output: {
    filename: '[name].js'
  },
  target: 'electron-main',
  plugins: [
    new CleanWebpackPlugin('dist'),
    new UglifyJSPlugin(),
    new SourceMapDevToolPlugin({
      filename: '[file].map'
    }),
    new CopyWebpackPlugin([
      {from: 'meta.json'}
    ])
  ]
};