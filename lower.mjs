import { AST } from "./ast.mjs";
import { parse } from "./grammar/parse.mjs";

const { make } = AST;

const lowerSteps = root => {
	root = root.transform(AST.Term, node => {
		switch (node.step.constructor) {
			case AST.CallSuffix:
				return make.Call(node.base, node.step.args).from(node);
			case AST.SubscriptSuffix:
				return make.Subscript(node.base, node.step.index).from(node);
		}
	});

	root = root.transform(AST.TypeTerm, node => {
		switch (node.step.constructor) {
			case AST.FunctionTypeSuffix:
				return make.FunctionType(node.base, node.step.params).from(node);
			case AST.ArrayTypeSuffix:
				return make.ArrayType(node.base, node.step.index).from(node);
		}
	});

	return root;
}

const lowerOperators = root => {
	root.forEach(AST.Assign, node => {
		if (node.op === "=") return;

		const baseOp = node.op.slice(0, -1);
		const nodeType = parse(
			`a ${baseOp} b`,
			{ term: "Expression" }
		).constructor.name;

		node.op = "=";
		node.right = make[nodeType](node.left, baseOp, node.right).from(node);
	});

	root.forEach(AST.Sum, node => {
		if (node.op === "-") {
			node.op = "+";
			node.right = make.Prefix("-", node.right).from(node.right);
		}
	});

	return root;
};

export default function lower(root) {
	root = lowerSteps(root);
	root = lowerOperators(root);
	return root;
}