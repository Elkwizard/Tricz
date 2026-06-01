import { AST } from "./ast.mjs";

const { make } = AST;

export default function clean(root) {
    root.decls ??= [];
    root.includes ??= [];

    root.forEach(AST.FunctionTypeSuffix, node => {
        node.params ??= [];
    });
    root.forEach(AST.CallSuffix, node => {
        node.args ??= [];
    });
    root.forEach(AST.Block, node => {
        node.stmts ??= [];
    });
    root.forEach(AST.Function, node => {
        node.params ??= [];
    });

    // clean up term-related parsing oddities
    root = root.transform(AST.Term, node => {
        switch (node.step.constructor) {
            case AST.CallSuffix:
                return make.Call(node.base, node.step.args).from(node);
            case AST.SubscriptSuffix:
                return make.Subscript(node.base, node.step.index).from(node);
            case AST.IndirectSubscriptSuffix:
                return make.IndirectSubscript(node.base, node.step.index).from(node);
            case AST.PropertyAccessSuffix:
                return make.PropertyAccess(node.base, node.step.field).from(node);
            case AST.IndirectPropertyAccessSuffix:
                return make.IndirectPropertyAccess(node.base, node.step.field).from(node);
        }
    });

    root = root.transform(AST.TypeTerm, node => {
        switch (node.step.constructor) {
            case AST.FunctionTypeSuffix:
                return make.FunctionType(node.base, node.step.params).from(node);
            case AST.ArrayTypeSuffix:
                return make.ArrayType(node.base, node.step.length).from(node);
        }
    });

    return root;
}