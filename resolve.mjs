import { AST } from "./ast.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";

class Resolver extends Visitor {
    constructor() {
        super();
        this.scopes = [];
    }
    visit(node) {
        const isScope = AST.match(node, "Scope");
        if (isScope) {
            node._parent = this.scopes.at(-1);
            this.scopes.push(node);
        }
        const result = super.visit(node);
        if (isScope) this.scopes.pop();
        return result;
    }
    declare(decl, scope = this.scopes.at(-1)) {
        const { _decls } = scope;

        if (_decls.has(decl.name))
            decl.error(`Cannot redeclare symbol '${decl.name}'`);

        _decls.set(decl.name, decl);

        decl._scope = scope;
    }
    resolveReferences(node) {
        node.forEach(["Reference", "Scope", "Declaration"], node => {
            if (!AST.match(node, "Reference")) {
                this.visit(node);
                return false;
            }

            if (node._decl || !node.name) return;

            for (let i = this.scopes.length - 1; i >= 0; i--) {
                const scope = this.scopes[i]._decls;

                if (scope.has(node.name)) {
                    node._decl = scope.get(node.name);
                    return;
                }
            }

            node.error(`Undefined symbol '${node.name}'`);
        });
    }
    While(loop) {
        if (loop.name && loop.body instanceof AST.Block)
            this.declare(loop, loop.body);
        this.resolveReferences(loop.condition);
        this.resolveReferences(loop.body);
        if (loop.continuing) this.resolveReferences(loop.continuing);
    }
    Block(block) {
        for (const stmt of block.stmts)
            this.resolveReferences(stmt);
    }
    Param(param) {
        this.resolveReferences(param.type);
        this.declare(param);
    }
    Variable(variable) {
        this.resolveReferences(variable.type);
        if (variable.value) this.resolveReferences(variable.value);
        this.declare(variable);
    }
    Field(field) {
        this.resolveReferences(field.type);
        this.declare(field);
    }
    Struct(struct) {
        for (const field of struct.fields)
            this.visit(field);
        this.declare(struct);
    }
    // functions are pre-declared, and thus don't declare themselves
    Function(fn) {
        this.resolveReferences(fn.result);
        
        for (const param of fn.params)
            this.visit(param);

        this.visit(fn.body);
    }
    root(root) {
        root.forEach("Scope", node => {
            node._decls = new Map();
        });

        // first put all global symbols into global scope, checking variables in order
        for (const decl of root.decls) {
            if (decl instanceof AST.Variable) {
                this.visit(decl);
            } else {
                this.declare(decl);
            }
        }

        // now check functions, since the global scope is full
        for (const decl of root.decls) {
            if (!(decl instanceof AST.Variable))
                this.visit(decl);
        }

        const entry = root._decls.get("main");
        if (!entry)
            root.error(`Program must contain an entry point: void main()`);

        if (!(entry instanceof AST.Function))
            entry.error("Entry point must be a function");

        root._entry = entry;

        root.forEach("Reference", ref => {
            if (ref._decl === root._entry)
                ref.error("Cannot refer to main function");
        });
    }
}

export default function resolveReferences(root) {
    new Resolver().visit(root);
    return root;
}