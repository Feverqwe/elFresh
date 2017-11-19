const {SourceMapDevToolPlugin, DefinePlugin} = require('webpack');
const UglifyJSPlugin = require('uglifyjs-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    dialog: './src/dialog'
  },
  output: {
    filename: '[name].js'
  },
  target: 'electron-renderer',
  module: {
    rules: [
      {
        test: /.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              'react',
              ['env', {
                "targets": {
                  "browsers": ["Chrome >= 58"]
                }
              }]
            ]
          }
        }
      },
      {
        test: /\.css/,
        use: [{
          loader: "style-loader"
        }, {
          loader: "css-loader"
        }, {
          loader: "clean-css-loader"
        }]
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new CleanWebpackPlugin('dist'),
    new UglifyJSPlugin({
      sourceMap: true
    }),
    new DefinePlugin({
      'process.env': {
        'NODE_ENV': JSON.stringify('production')
      }
    }),
    new SourceMapDevToolPlugin({
      filename: '[file].map'
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: 'src/index.html'
    })
  ]
};