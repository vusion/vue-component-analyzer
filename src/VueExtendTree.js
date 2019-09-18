const fs = require('fs-extra');
const path = require('path');
const babel = require('babel-core');

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

                const jsFile = new JSFile({
                    fullPath,
                    content,
                    babelResult: babel.transform(content, {
                        plugins: [
                            'syntax-dynamic-import',
                            'syntax-object-rest-spread',
                        ],
                    }),
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
            if (importPath.endsWith('.vue') && fs.statSync(importPath).isDirectory())
                importPath += '/index.js';
            else if (importPath.endsWith('dist/index.js'))
                importPath = importPath.replace(/dist\/index\.js$/, 'index.js');

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
     * e-2. export default ID [local]-> e-5, e-6, i-7, i-8, i-9, v-10, v-11
     * e-3. export { A as ID } [local]-> e-5, e-6, i-7, i-8, i-9, v-10, v-11
     * e-4. export * from
     * e-5. export const ID = {}
     * e-6. export const A = ID [local]->
     * i-7. import ID from [export]-> e-1, e-2
     * i-8. import { A as ID } from [export]-> e-3, e-4, e-5, e-6
     * i-9. import * from from [export]-> e-3, e-4, e-5, e-6
     * v-10. const ID
     * v-11. const A = ID [local]->
     *
     * 3 types:
     * from export default
     * from export
     * from local
     */
    findVueObject(jsFile, from = 'export', identifier = 'default', recursive = false, beforeNode, stack = []) {
        if (identifier === 'USubnavDivider')
            debugger;

        if (!identifier)
            throw new Error('Argument identifier is required!');

        return Promise.resolve(jsFile).then((jsFile) => {
            const babelResult = jsFile.babelResult;

            if (from !== 'export' && identifier === 'default')
                throw new Error('Identifier `default` is reserved word! Please set `from` as `export`');
            else if (from === 'export' && identifier === 'default') { // Find from export default, ignore 'from' param for easy way
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
                    return this.findVueObject(jsFile, 'local', exportDefaultName, recursive, undefined, stack);
                } else
                    return null;
            } else {
                // Find from exports
                if (from === 'export') {
                    const exportsNode = babelResult.metadata.modules.exports;
                    const externalAllSpecifiers = [];
                    const exportSpecifier = exportsNode.specifiers.find((specifier) => {
                        if (specifier.exported === identifier)
                            return true;
                        if (specifier.kind === 'external-all')
                            externalAllSpecifiers.push(specifier);
                        return false;
                    });
                    if (exportSpecifier && exportSpecifier.kind === 'local')
                        identifier = exportSpecifier.local; // Change identifier to local
                    else if (recursive) {
                        if (exportSpecifier && exportSpecifier.kind === 'external')
                            return this.importVueObject(jsFile.fullPath, exportSpecifier.source, identifier, stack);
                        else {
                            return Promise.all(externalAllSpecifiers.map((specifier) => this.importVueObject(jsFile.fullPath, specifier.source, identifier, stack)))
                                .then((results) => results.find((result) => !!result));
                        }
                    } else
                        throw new Error('Cannot find identifier in exports: ' + identifier);
                }

                if (recursive) {
                    // Find from imports
                    let importSpecifier;
                    const importsNode = babelResult.metadata.modules.imports.find((impt) => impt.specifiers.some((specifier) => {
                        if (specifier.local === identifier) {
                            importSpecifier = specifier;
                            return true;
                        } else
                            return false;
                    }));
                    if (importSpecifier)
                        return this.importVueObject(jsFile.fullPath, importsNode.source, importSpecifier.imported, stack);
                }

                // Find from local
                for (const node of babelResult.ast.program.body) {
                    if (node === beforeNode) // 必须在 beforeNode 声明之前
                        return null;

                    let declarations;
                    if (node.type === 'VariableDeclaration')
                        declarations = node.declarations;
                    else if (node.type === 'ExportNamedDeclaration')
                        declarations = node.declaration.declarations;
                    else
                        continue;

                    for (const declarator of declarations) {
                        if (declarator.type !== 'VariableDeclarator' || declarator.id.name !== identifier)
                            continue;
                        if (declarator.init.type === 'ObjectExpression') {
                            return {
                                objectExpression: declarator.init,
                                objectDeclaration: node,
                                jsFile,
                                identifier,
                                stack,
                            };
                        } else if (declarator.init.type === 'Identifier')
                            return this.findVueObject(jsFile, 'local', declarator.init.name, recursive, node, stack);
                    }
                }

                return null;
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

            return this.findVueObject(vueResult.jsFile, 'local', extendsName, true, vueResult.objectDeclaration, vueResult.stack).then((extendsResult) => {
                // this.loader.addDependency(vueResult.jsFile.fullPath);
                if (!extendsResult || !extendsResult.objectExpression)
                    throw new Error('Cannot find super vue object!');

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
