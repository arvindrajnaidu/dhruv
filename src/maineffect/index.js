
import vm from 'vm'
import traverse from  'traverse'
import * as babel from "@babel/core";

const getReplacementKey = key => `__maineffect_${key}_replacement__`

const getFirstIdentifier = (node) => {
    let firstIdentifier = null
    traverse(node).forEach((x) => {
        if (!firstIdentifier && x.type === 'Identifier') {
            firstIdentifier = x
        }
    })
    return firstIdentifier
}

// export const getCoverage = (reporter, config) => {
//     const context = libReport.createContext({
//         coverageMap: global.__mainEffect_coverageMap__
//     })    
//     const created = create(reporter, config)
//     return created.execute(context)
// }

const getIsolatedFn = (init) => {
    // console.log(JSON.stringify(init), '<<<')
    return {
        "type": "VariableDeclaration",
        "declarations": [
            {
                "type": "VariableDeclarator",
                "id": {
                    "type": "Identifier",
                    "name": "__evaluated__"
                },
                "init": init
            }
        ],
        "kind": "const"
    }
}

const evaluateScript = (thisParam = null, sandbox, scriptSrc, ...args) => {
    sandbox['__maineffect_args__'] = args
    sandbox['__maineffect_this__'] = thisParam

    // console.log(scriptSrc.code, '<<<')
    let testCode = `
            (function () {
                try {
                    ${scriptSrc.code}
                    const __maineffect_result__ = __evaluated__.apply(__maineffect_this__, __maineffect_args__)
                    return {
                        result: __maineffect_result__
                    }
                } catch (e) {
                    return {
                        exception: e
                    }
                }
            })()
        `
    // console.log(testCode)
    const testResult = vm.runInNewContext(testCode, sandbox)
    // const coverageMap = coverage.createCoverageMap(sandbox.__coverage__)

    // if (!global.__mainEffect_coverageMap__) {
    //     global.__mainEffect_coverageMap__ = coverageMap
    // } else {
    //     global.__mainEffect_coverageMap__.merge(coverageMap)
    // }

    return testResult
}

const CodeFragment = (scriptSrc, sandbox) => {
    // console.log(scriptSrc, '<<<<<<')
    let parsedCode
    if (typeof scriptSrc === 'string') {
        parsedCode = babel.parseSync(scriptSrc, {sourceType: 'module', ast: true, code: false})
    } else {
        parsedCode = scriptSrc
    }
    // console.log(JSON.stringify(parsedCode))
    let exception

    // console.log(JSON.stringify(parsedCode))
    return {
        find: (key) => {
            // console.log(JSON.stringify(parsedCode))
            const fn = traverse(parsedCode).reduce(function (acc, x) {
                if (x && 
                    x.type === 'VariableDeclarator' &&
                    x.id && x.id.name === key) {
                    return (getIsolatedFn(x.init))
                } else if (x && 
                    x.type === 'Property' &&
                    x.key && x.key.name === key) {
                        return getIsolatedFn(x.value)
                } else if (x && 
                    x.type === 'ObjectProperty' &&
                    x.key && x.key.name === key) {
                        return getIsolatedFn(x.value)
                } else if (x && 
                    x.type === 'MethodDefinition' &&
                    x.key && x.key.name === key) {
                        return getIsolatedFn(x.value)
                } else if (x && 
                    x.type === 'ClassMethod' &&
                    x.key && x.key.name === key) {
                        return getIsolatedFn({...x, type: 'FunctionExpression'})
                } else if (x && 
                    x.type === 'ClassDeclaration' &&
                    x.id && x.id.type === 'Identifier' &&
                    x.id.name === key) {
                        return x
                }
                return acc
            }, null)
            if (!fn) {
                throw new Error('Function not found')
            }
            // console.log(JSON.stringify(fn), '<<<')
            var ast = babel.types.file(babel.types.program([fn]));
            return CodeFragment(ast, sandbox)
        },
        provide: function (key, stub) {
            sandbox[key] = stub
            return this
        },
        source: () => {
            if (typeof scriptSrc !== 'string') {
                // console.log
                return babel.transformFromAstSync(scriptSrc).code
            }
            return scriptSrc
        },
        print: function (logger = console.log) {
            logger(scriptSrc)
            return this
        },
        fold: (key, replacement) => {
            sandbox[getReplacementKey(key)] = replacement
            const fn = traverse(parsedCode).map(function (x) {
                if (x && x.type === 'VariableDeclarator') {
                    if (x.id && x.id.name === key) {
                        this.update({...x, init: {
                                "type": "Identifier",
                                "name": getReplacementKey(key)
                            }
                        })
                    } else if (x.id && x.id.type === 'ObjectPattern') {
                        const matchedKeys = x.id.properties && x.id.properties.filter(p => p.key && p.key.name === key)
                        if (matchedKeys.length > 0) {
                            this.update({...x, init: {
                                    "type": "Identifier",
                                    "name": getReplacementKey(key)
                                }
                            })
                        }
                    }
                }
            })
            // const fnSrc = escodegen.generate(fn)
            return CodeFragment(fn, sandbox)
        },
        foldWithObject: function (folder) {
            if (Object.keys(folder).length === 0) {
                return this
            }
            return Object.keys(folder).reduce((prev, curr) => {
               prev = prev.fold(curr, folder[curr])
               return prev
            }, this)
        },
        destroy: (key) => {     
            const fn = traverse(parsedCode).map(function (x) {
                if (x && (x.type === 'CallExpression') && x.callee) {
                    // Under this callee if the first identifier matches key ... destroy
                    const firstIdentifierNode = getFirstIdentifier(x.callee)
                    if (firstIdentifierNode && firstIdentifierNode.name === key) {
                        this.update({
                            "type": "BlockStatement",
                            "body": []
                        })
                    }
                } 
            })
            // const fnSrc = escodegen.generate(fn)
            return CodeFragment(fn, sandbox)
        },
        callWith: (...args) => {
            let code
            if (typeof scriptSrc !== 'string') {
                code = babel.transformFromAstSync(scriptSrc)
            } else {
                code = scriptSrc
            }
            return evaluateScript(null, sandbox, code, ...args)
        },
        apply: (thisParam, ...args) => {
            let code
            if (typeof scriptSrc !== 'string') {
                code = babel.transformFromAstSync(scriptSrc)
            } else {
                code = scriptSrc
            }
            // console.log(sandbox, code.code, '<<<')
            return evaluateScript(thisParam, sandbox, code, ...args)
        }
    }
}

// export const removeFunctionCalls = (code, setupFns) => {
//     const parsedCode = ExtendedParser.parse(code, {sourceType: 'module'})
//     const fn = traverse(parsedCode).map(function (x) {
//         if (x && 
//             x.type === 'CallExpression' &&
//             x.callee &&
//             x.callee.type === 'Identifier' &&
//             (x.callee.name === 'require' || setupFns.includes(x.callee.name))
//             ) {
//                 return {
//                     "type": "ObjectExpression",
//                     "properties": []
//                 }
//         }
//         if (x &&
//             x.type === 'ImportDeclaration') {
//                 return {
//                     "type": "ObjectExpression",
//                     "properties": []
//                 }
//         }
//         if (x &&
//             x.type === 'ExportDefaultDeclaration') {
//                 return {
//                     "type": "ObjectExpression",
//                     "properties": []
//                 }
//         }
//         if (x &&
//             x.type === 'ExportNamedDeclaration') {
//             return x.declaration
//         }

//         return x
//     }, null)
    
//     return escodegen.generate(fn)
// }

const defaultOptions = { 
    removeSideEffects: true, 
    ignoreFnCalls: 'setup',
}

export const parseFn = (fileName, options) => {
    const finalOptions = options ? {...defaultOptions, ...options} : defaultOptions
    // const filename = require.resolve(fileName)
    // const fakeModule = {
    //         _compile: source => {
    //             // console.log('transformed code')
    //             // console.log(source)
    //         }
    //     }
    // // console.log(Module._extensions)

    // Module._extensions['.js'](fakeModule, filename)
    // const require = createRequ/ire(import.meta.url);
    // const m = module.require(fileName)
    // console.log('Resolving ', fileName, module.parent.paths)
    
    

    let code
    if (typeof fileName === 'function' ){
        code = fileName.toString()
    } else {
        const fnAbsName = require.resolve(fileName, {paths: module.parent.paths})
        const fs = require('fs')
        code = fs.readFileSync(fnAbsName, 'utf8')
        // console.log(fnAbsName)
    }
    
    // if (finalOptions.removeSideEffects) {
    //     const { ignoreFnCalls } = finalOptions
    //     code = removeFunctionCalls(code, Array.isArray(ignoreFnCalls) ? ignoreFnCalls : [ignoreFnCalls])
    // }

    const sb = vm.createContext({setTimeout, console})

    // Coverage
    // const instrumentedCode = instrumenter.instrumentSync(code, fileName)
    // vm.runInContext(instrumentedCode, sb)    
    return CodeFragment(code, sb)   
}

export const parseStr = (code) => {
    return CodeFragment(code)
}

export const load = parseFn

export default {
    parseFn,
    parseStr,
    load,
    parse: parseFn
}
