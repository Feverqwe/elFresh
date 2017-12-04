const gulp = require('gulp');
const webpack = require('webpack-stream');

gulp.task('copyFreshDialog', ['buildFreshDialog'], function () {
  return gulp.src('dist/*.html')
    .pipe(gulp.dest('../app/freshUi/dialog/'));
});

gulp.task('buildFreshDialog', function () {
  return gulp.src('src/dialog.jsx')
    .pipe(webpack(({
      config : require('./webpack.config.js')
    })))
    .pipe(gulp.dest('dist/'));
});

gulp.task('default', ['copyFreshDialog']);