const gulp = require('gulp');
const webpack = require('webpack-stream');
const del = require('del');
const filter = require('gulp-filter');
const zip = require('gulp-zip');
const hashsum = require('gulp-hashsum');

gulp.task('copyBgBundle', ['buildBgBundle'], function () {
  return gulp.src('dist/**')
    .pipe(gulp.dest('../app/bundle/'));
});

gulp.task('buildBgBundle', function () {
  return gulp.src('src/index.js')
    .pipe(webpack(({
      config : require('./webpack.config.js')
    })))
    .pipe(gulp.dest('dist/'));
});

gulp.task('zipFreshBundle', function () {
  return gulp.src('../app/bundle/**')
    .pipe(filter(function (file) {
      if (/\.map$/.test(file.path)) {
        return false;
      }
      return true;
    }))
    .pipe(zip('bundle.zip', {
      compress: true
    }))
    .pipe(hashsum({
      dest: '../dist/',
      filename: 'bundle.sha256',
      hash: 'sha256',
      json: true
    }))
    .pipe(gulp.dest('../dist/'))
});

gulp.task('clearBundle', function () {
  return del([
    '../app/bundle'
  ], {
    force: true
  });
});

gulp.task('default', ['copyBgBundle']);