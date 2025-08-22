// Copyright 2019 GitBitEx.com
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const gulp = require('gulp');
const webpack = require('webpack');
const minimist = require('minimist');
const proxy = require('http-proxy-middleware');
const gulpIf = require('gulp-if');
const concat = require('gulp-concat');
const htmlmin = require('gulp-htmlmin');
const less = require('gulp-less');
const cleanCSS = require('gulp-clean-css');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const rev = require('gulp-rev');
const revCollector = require('gulp-rev-collector');
const sourcemaps = require('gulp-sourcemaps');
const typescript = require('gulp-typescript');
const terser = require('gulp-terser');
const browserSync = require('browser-sync').create();
const history = require('connect-history-api-fallback');
const { deleteSync } = require('del');

const options = minimist(process.argv.slice(2));
const isProduction = options.env == 'prod';
const buildPath = './build/web';
const routeBase = '/';
// Read proxy settings from environment (useful for Codespaces). Default to local HTTP.
const apiProxy = process.env.API_PROXY || 'http://127.0.0.1:8080';
// API_PROXY_SECURE: set to 'true' to enable TLS verification; default is false for dev/self-signed certs
const apiProxySecure = process.env.API_PROXY_SECURE === 'true';

function createTask(task, taskName) {
    if (task.type == 'concat') {
        const cleanTaskName = taskName + '.clean';
        const runTaskName = taskName + '.run';
        gulp.task(cleanTaskName, function () {
            deleteSync([task.build + task.file], { force: true });
            return Promise.resolve();
        });

        const htmlMinOptions = {
            collapseWhitespace: true,
            collapseBooleanAttributes: true,
            removeComments: true,
            removeEmptyAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            minifyJS: true,
            minifyCSS: true
        };

        gulp.task(runTaskName, function () {
            // skip if no source files specified (avoid invalid glob error)
            if (!task.src || (Array.isArray(task.src) && task.src.length === 0) || (typeof task.src === 'string' && task.src.trim() === '')) {
                return Promise.resolve();
            }
            let stream = gulp.src(task.src)
                .pipe(concat(task.file));
            if (task.encrypt_js) stream = stream.pipe(terser());
            if (task.encrypt_css) stream = stream.pipe(cleanCSS());
            if (task.encrypt_html) stream = stream.pipe(htmlmin(htmlMinOptions));
            return stream.pipe(gulp.dest(task.build));
        });
        gulp.task(taskName, gulp.series(cleanTaskName, runTaskName, function (done) {
            browserSync.reload();
            done();
        }));
    }
    else if (task.type == 'copy') {
        const cleanTaskName = taskName + '.clean';
        gulp.task(cleanTaskName, function () {
            deleteSync([task.build], { force: true });
            return Promise.resolve();
        });
        gulp.task(taskName, gulp.series(cleanTaskName, function () {
            return gulp.src(task.src).pipe(gulp.dest(task.build));
        }));
    }
    else if (task.type == 'less') {
        const cleanTaskName = taskName + '.clean';
        const runTaskName = taskName + '.run';
        gulp.task(cleanTaskName, function () {
            deleteSync([task.build + task.file], { force: true });
            return Promise.resolve();
        });
        gulp.task(runTaskName, function () {
            return gulp.src(task.src)
                .pipe(less())
                .pipe(concat(task.file))
                .pipe(gulp.dest(task.build));
        });
        gulp.task(taskName, gulp.series(cleanTaskName, runTaskName, function (done) {
            browserSync.reload();
            done();
        }));
    }
    else if (task.type == 'webpack') {
        gulp.task(taskName, function (callback) {
            webpack(require("./gulp/webpack.config.js")(task, isProduction), function () {
                browserSync.reload();
                callback();
            });
        });
    }
    else if (task.type == 'clean') {
        gulp.task(taskName, function () {
            deleteSync([].concat(task.src), { force: true });
            return Promise.resolve();
        });
    }
    else if (task.type == 'md5') {
        const taskRev = taskName + ".rev";
        const taskReplace = taskName + ".replace";
        const taskClean = taskName + ".clean";
        const manifestName = taskName + ".rev.json";
        gulp.task(taskRev, function () {
            var pipe = gulp.src(task.src).pipe(rev()).pipe(gulp.dest(task.build))
                .pipe(rev.manifest()).pipe(rename(manifestName)).pipe(gulp.dest(task.build));
            return pipe;
        });
        gulp.task(taskReplace, function () {
            var files = require(task.build + manifestName);
            var pipe = gulp.src(task.page);
            for (var file in files) {
                console.log(task.page, file, files[file], task.pageBuild);
                pipe = pipe.pipe(replace(file, files[file]));
            }
            pipe = pipe.pipe(gulp.dest(task.pageBuild));
            return pipe;
        });
        gulp.task(taskClean, function () {
            deleteSync([task.build + "/*.rev.json"], { force: true });
            return Promise.resolve();
        });
    }
}

const tasks = [];

gulp.task('browser-sync', function (done) {
    browserSync.init({
        startPath: routeBase,
        server: {
            baseDir: buildPath,
            middleware: [proxy('/api', {
                target: apiProxy,
                changeOrigin: true,
                logLevel: 'debug',
                secure: apiProxySecure,
            }), history({
                rewrites: [
                    {
                        from: new RegExp( "/^" + routeBase + "assets/(.*)$", "gi"),
                        to: function(context) {
                            return routeBase + 'assets/' + context.match[1]
                        }
                    },
                    {
                        from: new RegExp( "/^" + routeBase + "(.*)$", "gi"),
                        to: routeBase + 'index.html'
                    }
                ]
            })]
        }
    });
    done();
});
tasks.push('browser-sync');

const config = require('./gulp/gulp.config')(isProduction, buildPath + routeBase);

for (const key in config["base"]) {
    const task = config["base"][key];
    const taskName = "base." + key;
    createTask(task, taskName);
    gulp.watch(task.watch || task.src, gulp.series(taskName));
    tasks.push(taskName);
}

for (const key in config["prod"]) {
    const task = config["prod"][key];
    const taskName = key;
    createTask(task, taskName);
}

const resourcePath = buildPath + routeBase;

gulp.task('clean', function () {
    deleteSync([resourcePath], { force: true });
    return Promise.resolve();
});
gulp.task('clean-assets', function () {
    deleteSync([resourcePath + 'assets/'], { force: true });
    return Promise.resolve();
});

function prodMd5Tasks() {
    return gulp.series(
        "vendor.script.md5.rev", "vendor.script.md5.replace", "vendor.script.md5.clean",
        "app.script.md5.rev", "app.script.md5.replace", "app.script.md5.clean",
        "app.style.md5.rev", "app.style.md5.replace", "app.style.md5.clean",
        "app.md5.clean"
    );
}

gulp.task("default", gulp.series('clean', function defaultTask(done) {
    if (isProduction) {
        return gulp.series(
            gulp.parallel(...tasks),
            prodMd5Tasks()
        )(done);
    } else {
        return gulp.parallel(...tasks)(done);
    }
}));