import { AST, makeReference } from "./ast.mjs";

const { make } = AST;

const extractInitializer = variable => {
	const { value } = variable;
	if (!value) return undefined;
	
	variable.value = undefined;
	return make.ExpressionStatement(make.Assign(
		makeReference(variable),
		"=",
		value
	)).from(variable);
};

const lowerGlobalVars = root => {
	const globalVars = root.decls.filter(decl => decl instanceof AST.Variable);

	const initializers = globalVars.map(extractInitializer);
	
	// put global variable initializers into main
	root._entry.body.stmts.unshift(...initializers);

	return root;
};

const lowerInitializers = root => {
	root = root.transform(AST.Variable, node => {
		const initializer = extractInitializer(node);
		if (!initializer) return node;

		return [node, initializer];
	});
	
	return root;
};

export default function lowerResolved(root) {
	lowerGlobalVars(root);
	root = lowerInitializers(root);
	return root;
}