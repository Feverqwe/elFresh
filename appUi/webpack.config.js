const {SourceMapDevToolPlugin} = require('webpack');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    appUi: './src'
  },
  output: {
    filename: '[name].js'
  },
  target: 'electron-renderer',
  plugins: [
    new CleanWebpackPlugin('dist'),
    new UglifyJSPlugin(),
    new SourceMapDevToolPlugin({
      filename: '[file].map'
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: 'src/index.html'
    }),
  ]
};