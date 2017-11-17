const gulp = require('gulp');
const webpack = require('webpack-stream');

gulp.task('copyUiBundle', ['buildUiBundle'], function () {
  return gulp.src('dist/**')
    .pipe(gulp.dest('../app/bundle/'));
});

gulp.task('buildUiBundle', function () {
  return gulp.src('src/index.js')
    .pipe(webpack(({
      config : require('./webpack.config.js')
    })))
    .pipe(gulp.dest('dist/'));
});

gulp.task('default', ['copyUiBundle']);