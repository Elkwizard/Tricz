import { AST } from "./ast.mjs";
import { parse } from "./grammar/parse.mjs";

const { make } = AST;

const lowerDeclarations = root => {
    const functions = root.decls
        .filter(decl => decl instanceof AST.Function);
    const nonFunctions = root.decls
        .filter(decl => !(decl instanceof AST.Function));

    root.decls = [...functions, ...nonFunctions];

    return root;
};

const lowerOperators = root => {
    root.forEach(AST.Assign, node => {
        if (node.op === "=") return;

        const baseOp = node.op.slice(0, -1);
        const nodeType = parse(
            `a ${baseOp} b`,
            { term: "Expression" }
        ).constructor.name;

        node.op = "=";
        node.right = make[nodeType](
            node.left, baseOp, node.right
        ).from(node);
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
    root = lowerDeclarations(root);
    root = lowerOperators(root);
    return root;
}