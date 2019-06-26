const { VueExtendTree } = require('../../../');
const node = require('enhanced-resolve/lib/node');

// webpack同步文件解析 https://blog.johnnyreilly.com/2016/12/webpack-syncing-enhanced-resolve.html
function makeSyncResolver(options) {
    return node.create.sync(options.resolve);
}
const resolveSync = makeSyncResolver({});

const vueExtendTree = new VueExtendTree();
vueExtendTree.resolve = (request, path) => resolveSync(path, request);

return vueExtendTree.findSuperByPath('./xxx.vue').then((supr) => {
    console.log(supr);
});
