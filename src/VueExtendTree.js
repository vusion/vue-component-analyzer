const fs = require('fs-extra');
const path = require('path');
const babel = require('@babel/core');
const traverse = require('@babel/traverse').default;
class JSFile {
    // extends;
    constructor(options) {
        Object.assign(this, options);
    }
}

class VueExtendTree {
    constructor(options) {
        // Pass loader
        this.caches = {};
        Object.assign(this, options);
    }

    purge(files) {
        files.forEach((file) => Object.keys(this.caches).forEach((key) => {
            if (key.startsWith(file))
                delete this.caches[key];
        }));
    }

    build() {
    // @TODO
    // @TODO: watch deps
    // @TODO: circular deps
    }

    loadJSFile(fullPath) {
        if (this.caches[fullPath])
            return Promise.resolve(this.caches[fullPath]);
        else {
            return fs.readFile(fullPath).then((content) => {
                content = content.toString();
                const isVue = fullPath.endsWith('.vue');
                if (isVue) {
                    const found = content.match(/<script>([\s\S]+)<\/script>/);
                    content = found ? found[1] : '';
                }
                const result = babel.transform(content, {
                    ast: true,
                    plugins: ['@babel/plugin-syntax-dynamic-import'],
                });
                const jsFile = new JSFile({
                    fullPath,
                    content,
                    babelResult: result,
                    isVue,
                });

                this.caches[fullPath] = jsFile;
                return jsFile;
            });
        }
    }

    findExtendsName(objectExpression) {
        const extendsProperty = objectExpression.properties.find((property) => property.key.name === 'extends' && property.value.type === 'Identifier');
        if (!extendsProperty)
            throw new Error('Cannot find extends');
        return extendsProperty.value.name;
    }

    importVueObject(fullPath, sourcePath, identifier, stack) {
        return new Promise((resolve, reject) => {
            let importPath = this.resolve(sourcePath, path.dirname(fullPath));
            // let importPath = path.resolve(path.dirname(fullPath), sourcePath);
            if (importPath.endsWith('.vue') && fs.statSync(importPath).isDirectory())
                importPath += '/index.js';
            else if (importPath.endsWith('dist/index.js'))
                importPath = importPath.replace(/dist\/index\.js$/, 'index.js');
            else if (fs.statSync(importPath).isDirectory())
                importPath += '/index.js';

            const uuid = importPath + ' && ' + identifier;
            if (stack.includes(uuid))
                return reject('Circular import:\n' + stack);
            stack.push(uuid);
            return resolve(this.loadJSFile(importPath)
                .then((jsFile) => this.findVueObject(jsFile, 'export', identifier, true, undefined, stack)));
        });
    }

    /**
     * Find vue object recursively
     * @param {*} jsFile - Babel result
     * @param {*} identifier
     * @param {FromType} from - 'local' or 'export' - find from local or exports;
     * @param {*} recursive
     * @return { objectExpression, jsFile, identifier }
     *
     * @examples
     * e-1. export default {}
     * e-2. export default ID | [local]-> e-5, e-6, i-7, i-8, i-9, v-10, v-11
     * e-3. export { A as ID } | [local]-> e-5, e-6, i-7, i-8, i-9, v-10, v-11
     * e-4. export * from
     * e-5. export const ID = {}
     * e-6. export const A = ID | [local]->
     * i-7. import ID from | [export]-> e-1, e-2
     * i-8. import { A as ID } from | [export]-> e-3, e-4, e-5, e-6
     * i-9. import * from | [export]-> e-3, e-4, e-5, e-6
     * v-10. const ID
     * v-11. const A = ID | [local]->
     *
     * 3 types:
     * from export default
     * from export
     * from local
     */
    findVueObject(jsFile, from = 'export', identifier = 'default', recursive = false, stack = []) {
        if (identifier === 'USubnavDivider')
            debugger;

        if (!identifier)
            throw new Error('Argument identifier is required!');

        return Promise.resolve(jsFile).then((jsFile) => {
            const babelResult = jsFile.babelResult;

            if (from !== 'export' && identifier === 'default') // no export just default
                throw new Error('Identifier `default` is reserved word! Please set `from` as `export`');
            else if (from === 'export' && identifier === 'default') { // Find from export default, ignore 'from' param for easy way
                // export default
                const exportDefault = babelResult.ast.program.body.find((node) => node.type === 'ExportDefaultDeclaration');
                if (!exportDefault)
                    throw new Error('Cannot find export default');

                if (exportDefault.declaration.type === 'ObjectExpression')
                    return {
                        objectExpression: exportDefault.declaration,
                        objectDeclaration: exportDefault,
                        jsFile,
                        identifier,
                        stack,
                    };
                else if (exportDefault.declaration.type === 'Identifier') {
                    const exportDefaultName = exportDefault.declaration.name;
                    return this.findVueObject(jsFile, 'local', exportDefaultName, recursive, stack);
                } else
                    return null;
            } else {
                // Find from exports
                if (from === 'export') {
                    // const exportsNode = babelResult.metadata.modules.exports;
                    const externalAllSpecifiers = [];
                    let exportsDeclaratorNode;
                    let exportsSpecifyNode;
                    let exportsSource;
                    traverse(babelResult.ast, {
                        ExportNamedDeclaration(path) {
                            path.traverse({
                                VariableDeclarator(path) {
                                    if (path.node.id.name === identifier) {
                                        exportsDeclaratorNode = path.node;
                                    }
                                },
                                ExportSpecifier(path) {
                                    if (path.node.exported.name === identifier) {
                                        exportsSpecifyNode = path.node;
                                        exportsSource = path.parent.source.value;
                                    }
                                },

                            }, { node: path.node });
                        },
                        ExportAllDeclaration(path) {
                            externalAllSpecifiers.push(path.node);
                        },
                    });
                    if (exportsSpecifyNode) {
                        const localname = exportsSpecifyNode.local.name;
                        if (!exportsSource) {
                            // export { A as B }
                            identifier = localname;
                        } else {
                            // export { YYY } from './bbb';
                            if (recursive)
                                return this.importVueObject(jsFile.fullPath, exportsSource, localname, stack);
                            else
                                throw new Error('no recursive!');
                        }
                    } else if (exportsDeclaratorNode) {
                        // export const A = { a: 'xxx' }
                        return {
                            objectExpression: exportsDeclaratorNode.init,
                            objectDeclaration: exportsDeclaratorNode,
                            jsFile,
                            identifier,
                            stack,
                        };
                    } else if (recursive && externalAllSpecifiers.length) {
                        // export * from
                        return Promise.all(externalAllSpecifiers.map((declaration) =>
                            this.importVueObject(jsFile.fullPath, declaration.source.value, identifier, stack)))
                            .then((results) => results.find((result) => !!result));
                    }
                }

                if (recursive) {
                    // Find from imports
                    let importSource;
                    let ident = identifier;
                    traverse(babelResult.ast, {
                        enter(path) {
                            if (path.parentKey === 'body') {
                                if (path.node.type === 'ImportDeclaration') {
                                    let found = false;
                                    path.traverse({
                                        ModuleSpecifier(path) {
                                            if (path.node.local.name === identifier) {
                                                found = true;
                                                ident = path.node.imported ? path.node.imported.name : ident;
                                            }
                                        },
                                    });
                                    if (found) {
                                        importSource = path.node.source.value;
                                    }
                                }

                                path.skip();
                            }
                        },
                    });
                    // const importsNode = babelResult.metadata.modules.imports.find((impt) => impt.specifiers.some((specifier) => {
                    //     if (specifier.local.name === identifier) {
                    //         importSpecifier = specifier;
                    //         return true;
                    //     } else
                    //         return false;
                    // }));
                    if (importSource)
                        return this.importVueObject(jsFile.fullPath, importSource, ident, stack);
                }

                // Find from local
                const target = null;

                // 外层定义
                let declarator = null;
                let objectDeclaration = null;
                let objectExpression = null;
                // const iterator = babelResult.ast.program.body;
                traverse(babelResult.ast, {
                    enter(path) {
                        if (path.parentKey === 'body') {
                            const node = path.node;
                            if (node.type === 'VariableDeclaration') {
                                const dec = node.declarations.find((declarator) => declarator.id.name === identifier);
                                if (dec) {
                                    declarator = dec;
                                    objectExpression = declarator.init;
                                    objectDeclaration = node;
                                }
                            } else if (/Declaration/.test(node.type)) {
                                path.traverse({
                                    VariableDeclarator(path) {
                                        const dec = path.node;

                                        if (dec.id.name === identifier) {
                                            declarator = dec;
                                            objectExpression = declarator.init;
                                            objectDeclaration = node;
                                        }
                                    },
                                });
                            }
                            // statements always come after declarations
                            if (node.type === 'ExpressionStatement') {
                                if (node.expression.left && node.expression.left.name === identifier) {
                                    objectExpression = node.expression.right;
                                    objectDeclaration = node;
                                }
                            }
                            path.skip();
                        }
                    },
                });
                // for (const node of iterator) {
                //     if (node.type === 'VariableDeclaration') {
                //         const dec = node.declarations.find((declarator) => declarator.id.name === identifier);
                //         if (dec) {
                //             declarator = dec;
                //             objectExpression = declarator.init;
                //             objectDeclaration = node;
                //         }
                //     } else if (/Declaration/.test(node.type)) {
                //         traverse(node, {
                //             VariableDeclarator(path) {
                //                 const dec = path.node.declarations.find((declarator) => declarator.id.name === identifier);
                //                 if (dec) {
                //                     declarator = dec;
                //                     objectExpression = declarator.init;
                //                     objectDeclaration = node;
                //                 }
                //             },
                //         });
                //     }

                //     // statements always come after declarations
                //     if (node.type === 'ExpressionStatement') {
                //         if (node.expression.left && node.expression.left.name === identifier) {
                //             objectExpression = node.expression.right;
                //             objectDeclaration = node;
                //         }
                //     }
                // }
                if (declarator) {
                    if (objectExpression && objectExpression.type === 'ObjectExpression') {
                        return {
                            objectExpression,
                            objectDeclaration,
                            jsFile,
                            identifier,
                            stack,
                        };
                    } else if (objectExpression && objectExpression.type === 'Identifier') {
                        return this.findVueObject(jsFile, 'local', objectExpression.name, recursive, stack);
                    }
                    return null;
                }

                return target;
            }
        });
    }

    findSuper(jsFile) {
        return this.findVueObject(jsFile).then((vueResult) => {
            // this.loader.addDependency(jsFile.fullPath);
            if (!vueResult)
                throw new Error('Cannot find vue object!');

            if (vueResult.jsFile.extends) // Cached
                return vueResult.jsFile.extends;

            const extendsName = vueResult.objectExpression ? this.findExtendsName(vueResult.objectExpression) : vueResult.identifier;
            if (!extendsName)
                throw new Error('Cannot find extends name!');

            return this.findVueObject(vueResult.jsFile, 'local', extendsName, true, vueResult.stack).then((extendsResult) => {
                // this.loader.addDependency(vueResult.jsFile.fullPath);
                if (!extendsResult || !extendsResult.objectExpression)
                    throw new Error('Cannot find super vue object!: ' + jsFile.fullPath);

                vueResult.jsFile.extends = extendsResult.jsFile;
                return extendsResult.jsFile;
            });
        });
    }

    findSuperByPath(fullPath) {
        return this.loadJSFile(fullPath).then((jsFile) => this.findSuper(jsFile));
    }
}

module.exports = {
    JSFile,
    VueExtendTree,
};
