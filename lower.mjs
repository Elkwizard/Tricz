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
    root = root.transform(AST.Prefix, node => {
        const { target: a, op } = node;

        switch (op) {
            case "-": return make.Negate(a).from(node);
            case "&": return make.AddressOf(a).from(node);
            case "@": return make.Dereference(a).from(node);
            case "!": return make.Not(a).from(node);
            case "--": return make.Assign(a, "-=", make.Int("1")).from(node);
            case "++": return make.Assign(a, "+=", make.Int("1")).from(node);
        }
    });

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
            node.right = make.Negate(node.right).from(node.right);
        }
    });

    return root;
};

const lowerLoops = root => {

    root = root.transform(AST.For, node => {
        const loop = make.While(
            node.condition ?? make.Bool("true").from(node),
            node.body,
            node.next ? make.ExpressionStatement(node.next).from(node.next) : undefined
        ).from(node);

        if (node.init)
            return make.Block([
                node.init,
                loop
            ]);

        return loop;
    });

    return root;
};

export default function lower(root) {
    root = lowerDeclarations(root);
    root = lowerOperators(root);
    root = lowerLoops(root);
    return root;
}