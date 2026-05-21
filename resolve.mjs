import { AST } from "./ast.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";

class Resolver extends Visitor {
    constructor() {
        super();
        this.scopes = [];
    }
    visit(node) {
        const isScope = AST.match(node, "Scope");
        if (isScope) this.scopes.push(node);
        const result = super.visit(node);
        if (isScope) this.scopes.pop();
        return result;
    }
    declare(decl) {
        this.scopes.at(-1)._scope.set(decl.name, decl);
    }
    resolveReferences(node) {
        node.forEach(["Reference", "Scope"], node => {
            if (AST.match(node, "Scope")) {
                this.visit(node);
                return false;
            }

            if (node._decl) return;

            for (let i = this.scopes.length - 1; i >= 0; i--) {
                const scope = this.scopes[i]._scope;

                if (scope.has(node.name)) {
                    node._decl = scope.get(node.name);
                    return;
                }
            }

            node.error(`Undefined symbol '${node.name}'`);
        });
    }
    Block(block) {
        for (const stmt of block.stmts) {
            this.resolveReferences(stmt);
            if (AST.match(stmt, "Declaration"))
                this.declare(stmt);
        }
    }
    Param(param) {
        this.resolveReferences(param.type);
    }
    Variable(variable) {
        this.resolveReferences(variable.type);
        if (variable.value) this.resolveReferences(variable.value);
    }
    Function(fn) {
        this.resolveReferences(fn.result);
        
        for (const param of fn.params) {
            this.declare(param);
            this.visit(param);
        }

        this.visit(fn.body);
    }
    root(root) {
        root.forEach("Scope", node => {
            node._scope = new Map();
        });

        // first put all global symbols into global scope, checking variables in order
        for (const decl of root.decls) {
            this.declare(decl);
            if (decl instanceof AST.Variable)
                this.visit(decl);
        }

        // now check functions, since the global scope is full
        for (const decl of root.decls) {
            if (decl instanceof AST.Function)
                this.visit(decl);
        }

        const entry = root._scope.get("main");
        if (!entry)
            root.error(`Program must contain an entry point: void main()`);

        if (!(entry instanceof AST.Function))
            entry.error("Entry point must be a function");

        root._entry = entry;
    }
}

export default function resolveReferences(root) {
    new Resolver().visit(root);
    return root;
}