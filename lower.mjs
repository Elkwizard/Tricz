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
    root = root.transform(AST.IndirectSubscript, node => {
        return make.Subscript(
            make.Dereference(node.arr).from(node.arr),
            node.index
        ).from(node);
    });

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
            node.name,
            node.condition ?? make.Bool("true").from(node),
            node.body,
            node.next ? make.Continuing(
                make.ExpressionStatement(node.next)
            ).from(node.next) : undefined
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

const lowerArrayInitializers = root => {
    root.forEach(AST.Array, node => {
        if (!node.elements.length)
            node.error(`Cannot specify an array literal without elements`);
    });

    root.forEach(AST.Variable, node => {
        if (!node.value) return node;

        const typeLayers = [];
        let currentType = node.type;
        while (currentType instanceof AST.ArrayType) {
            typeLayers.push(currentType);
            currentType = currentType.element;
        }

        if (!typeLayers.length) return;

        const initLayers = [];
        let currentValue = node.value;
        while (currentValue instanceof AST.Array) {
            initLayers.push(currentValue);
            currentValue = currentValue.elements[0];
        };

        for (let i = 0; i < typeLayers.length; i++) {
            const type = typeLayers[i];
            if (type.length) continue;

            if (i >= initLayers.length)
                node.value.error(`An array initializer must have enough dimensions to fully specify implied lengths`);

            const { length } = initLayers[i].elements;
            type.length = make.Int(String(length));
        }
    });

    root.forEach(AST.ArrayType, node => {
        if (!node.length)
            node.error(`Cannot specify un-lengthed array type without an initializer`);
    });
};

export default function lower(root) {
    root = lowerDeclarations(root);
    root = lowerOperators(root);
    root = lowerLoops(root);
    lowerArrayInitializers(root);
    return root;
}