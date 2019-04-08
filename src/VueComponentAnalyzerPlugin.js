const { VueExtendTree } = require('./VueExtendTree');

class VueComponentAnalyzerPlugin {
    constructor() {
        this.vueExtendTree = new VueExtendTree();
    }

    apply(compiler) {
        // 试过各种方法都不行，只能霸王硬上弓了。。
        compiler.constructor.Watching.prototype.watch = function watch(files, dirs, missing) {
            this.pausedWatcher = null;
            this.watcher = this.compiler.watchFileSystem.watch(files, dirs, missing, this.startTime, this.watchOptions, (err, filesModified, contextModified, missingModified, fileTimestamps, contextTimestamps) => {
                this.pausedWatcher = this.watcher;
                this.watcher = null;
                if (err)
                    return this.handler(err);

                this.compiler.fileTimestamps = fileTimestamps;
                this.compiler.contextTimestamps = contextTimestamps;
                this.invalidate();
                // @modified
                this.compiler.applyPlugins('invalidate', filesModified, contextModified, missingModified, fileTimestamps, contextTimestamps);
            }, (fileName, changeTime) => {
                this.compiler.applyPlugins('invalid', fileName, changeTime);
            });
        };

        // @TODO: 这里 Webpack 的策略是每次 compiler 的时候重建 watcher，因此用的是 once
        compiler.plugin('invalidate', (filesModified, contextModified, missingModified, fileTimestamps, contextTimestamps) => {
            this.vueExtendTree.purge(filesModified.concat(contextModified, missingModified));
        });

        compiler.plugin('compilation', (compilation, params) => {
            compilation.plugin('normal-module-loader', (loaderContext, module) => {
                loaderContext.vueComponentAnalyzerPlugin = this;
            });
        });
    }
}

module.exports = VueComponentAnalyzerPlugin;
