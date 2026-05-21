import { AST } from "./ast.mjs";

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
	return root;
}