import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";
import IndentedPrinter from "/G:/My Drive/Desktop/Pipelang2/util/indent.mjs";
import { AST } from "./ast.mjs";
import { styleText } from "node:util";

class PrettyPrinter extends Visitor {
	constructor() {
		super();
		this.printer = new IndentedPrinter(4);
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
	Prefix({ op, target }) {
		this.tag`(${styleText("magenta", op)}${target})`;
	}
	Suffix({ op, target }) {
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
	}
}

AST.prototype.toString = function () {
	return prettyPrint(this);
};

export default function prettyPrint(root) {
	const printer = new PrettyPrinter();
	printer.visit(root);
	return printer.toString();
}