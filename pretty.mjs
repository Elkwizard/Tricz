import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";
import IndentedPrinter from "/G:/My Drive/Desktop/Pipelang2/util/indent.mjs";
import { AST } from "./ast.mjs";
import { styleText } from "node:util";

class PrettyPrinter extends Visitor {
    constructor({
        decor = true
    } = { }) {
        super();
        this.decor = decor;
        this.printer = new IndentedPrinter(4);
    }
    visit(node) {
        super.visit(node);

        if (this.decor) {
            if (node._type && !AST.match(node, "Type"))
                this.print(styleText("red", `<${node._type}>`));
        }
    }
    tag(pieces, ...subs) {
        this.printer.tag(x => this.visit(x), pieces, subs);
    }
    // expressions
    Literal({ value }) {
        this.print(styleText("yellow", value));
    }
    Reference({ name }) {
        this.print(name);
    }
    Ternary({ condition, ifTrue, ifFalse }) {
        this.tag`(${condition} ${styleText("magenta", "?")} ${ifTrue} ${styleText("magenta", ":")} ${ifFalse})`;
    }
    Prefix({ op, target }) {
        this.tag`(${styleText("magenta", op)}${target})`;
    }
    Increment({ op, target }) {
        this.tag`(${target}${styleText("magenta", op)})`;
    }
    Cast({ target, type }) {
        this.tag`(${target} ${styleText("magenta", "as")} ${type})`;
    }
    Subscript({ arr, index }) {
        this.tag`${arr}[${index}]`;
    }
    Call({ fn, args }) {
        if (fn instanceof AST.Reference) {
            this.tag`${styleText("green", fn.name)}`;
        } else {
            this.tag`${fn}`;
        }
        this.tag`(${[args, ", "]})`;
    }
    BinaryOperator({ left, op, right }) {
        this.tag`(${left} ${styleText("magenta", op)} ${right})`;
    }
    Array({ elements }) {
        this.tag`[${[elements, ", "]}]`;
    }
    // types
    TypeReference({ name }) {
        this.print(name);
    }
    PointerType({ target }) {
        this.tag`${styleText("cyan", "&")}${target}`;
    }
    LiteralType({ name }) {
        this.print(styleText("cyan", name));
    }
    ArrayType({ element, length }) {
        this.tag`${element}[${length ?? ""}]`;
    }
    // statements
    ExpressionStatement({ value }) {
        this.tag`${value};\n`;
    }
    Block({ stmts }) {
        this.println("{");
        this.indent();
        for (const stmt of stmts)
            this.visit(stmt);
        this.unindent();
        this.println("}");
    }
    For({ init, condition, next, body }) {
        this.tag`${styleText("magenta", "for")} (\n`;
        this.indent();
        if (init) this.visit(init);
        else this.println();
        if (condition) this.tag`${condition};\n`;
        else this.println();
        if (next) this.tag`${next}\n`;
        else this.println();
        this.unindent();
        this.tag`) ${body}`;
    }
    While({ condition, body, continuing }) {
        this.tag`${styleText("magenta", "while")} (${condition}) ${body}`;
        if (continuing) this.tag`${styleText("magenta", "continuing")} ${continuing}`;
    }
    If({ condition, ifTrue, ifFalse }) {
        this.tag`${styleText("magenta", "if")} (${condition}) ${ifTrue}`;
        if (ifFalse) this.tag`${styleText("magenta", "else")} ${ifFalse}`;
    }
    Return({ value }) {
        this.print(styleText("magenta", "return"));
        if (value) this.tag` ${value}`;
        this.println(";");
    }
    // declarations
    Include({ path }) {
        this.tag`include ${path};`;
    }
    Variable({ type, name, value }) {
        this.tag`${type} ${name}`;
        if (value) this.tag` = ${value}`;
        this.println(";");
    }
    Param({ type, name }) {
        this.tag`${type} ${name}`;
    }
    Function({ result, name, params, body }) {
        this.tag`${result} ${styleText("green", name)}(${[params, ", "]}) ${body}`;
    }
    root({ includes, decls }) {
        for (const include of includes)
            this.visit(include);
        
        for (const decl of decls) {
            this.visit(decl);
            this.println();
        }
    }
    static {
        for (const key of ["print", "println", "indent", "unindent", "toString"]) {
            this.prototype[key] = function (...args) {
                return this.printer[key](...args);
            };
        }

        for (const key of ["Sum", "Product", "Compare", "Logic", "Assign"]) {
            this.prototype[key] = this.prototype.BinaryOperator;
        }

        for (const key of ["Int", "Fixed", "Bool"]) {
            this.prototype[key] = this.prototype.Literal;
        }

        for (const key of ["IntType", "VoidType", "FixedType", "BoolType"]) {
            this.prototype[key] = this.prototype.LiteralType;
        }

        const prefixes = {
            Negate: "-",
            AddressOf: "&",
            Dereference: "@",
            Not: "!"
        };
        for (const key in prefixes) {
            this.prototype[key] = function (node) {
                this.tag`${styleText("magenta", prefixes[key])}${node.target}`;
            };
        }
    }
}

AST.prototype.toString = function () {
    return prettyPrint(this, { decor: false });
};

export default function prettyPrint(root, options) {
    const printer = new PrettyPrinter(options);
    printer.visit(root);
    return printer.toString();
}