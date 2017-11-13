const gulp = require('gulp');
const webpack = require('webpack-stream');

gulp.task('copyBgModulesBundle', ['buildBgModulesBundle'], function () {
  return gulp.src('dist/**')
    .pipe(gulp.dest('../app/bundle/'));
});

gulp.task('buildBgModulesBundle', function () {
  return gulp.src('src/index.js')
    .pipe(webpack(({
      config : require('./webpack.config.js')
    })))
    .pipe(gulp.dest('dist/'));
});

gulp.task('default', ['copyBgModulesBundle']);