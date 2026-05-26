import { AST } from "./ast.mjs";
import exportGraph from "./dot.mjs";
import { ArrayType, FunctionType, PointerType, PrimitiveType, Type } from "./types.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";


class TypeChecker extends Visitor {
    constructor() {
        super();
        this.functions = [];
        this.loops = [];
        this.calls = new Map();
    }
    visit(node) {
        return node._type ??= super.visit(node);
    }
    // type
    IntType() {
        return PrimitiveType.INT;
    }
    FixedType() {
        return PrimitiveType.FIXED;
    }
    BoolType() {
        return PrimitiveType.BOOL;
    }
    VoidType() {
        return PrimitiveType.VOID;
    }
    PointerType(ptr) {
        return new PointerType(this.visit(ptr.target));
    }
    ArrayType(arr) {
        const { length } = arr;
        if (!(length instanceof AST.Int))
            length.error(`Array length must be a constant integer`);

        return new ArrayType(this.visit(arr.element), +length.value);
    }
    FunctionType(fn) {
        return new FunctionType(
            this.visit(fn.result),
            fn.params.map(param => this.visit(param))
        );
    }
    // expressions
    Int() {
        return PrimitiveType.INT;
    }
    Fixed() {
        return PrimitiveType.FIXED;
    }
    Bool() {
        return PrimitiveType.BOOL;
    }
    Array(node) {
        const { elements } = node;

        const elementType = elements
            .map(element => this.visit(element))
            .reduce((a, b) => a ? Type.common(a, b) : null);

        if (!elementType)
            node.error(`Cannot deduce common element type for array. Element types were [${elements.map(el => this.visit(el)).join(", ")}]`);

        for (let i = 0; i < elements.length; i++)
            this.assertConvertible(
                elements[i], elementType,
                (src, dst) => `Cannot have array element of type '${src}' in array with elements of type '${dst}'`
            );

        return new ArrayType(elementType, elements.length);
    }
    Reference(node) {
        const { _decl } = node;
        if (_decl instanceof AST.While)
            node.error(`Cannot refer to loop label as an expression`);
        return this.visit(node._decl);
    }
    AddressOf(node) {
        this.assertLValue(node.target, `Cannot take the address of a non-lvalue`);
        return new PointerType(this.visit(node.target));
    }
    Dereference(node) {
        const ptrType = this.visit(node.target);

        if (!(ptrType instanceof PointerType))
            node.error(`Cannot dereference non-pointer type '${ptrType}'`);

        return ptrType.target;
    }
    Increment(node) {
        return this.getArithmeticType(node.target);
    }
    Ternary(node) {
        this.assertCondition(node.condition);

        const trueType = this.visit(node.ifTrue);
        const falseType = this.visit(node.ifFalse);

        const common = Type.common(trueType, falseType);

        if (!common) node.error(`No common type exists between ? options, '${trueType}' and '${falseType}'`);

        return common;
    }
    Not(node) {
        this.assertLogical(node.target);
        return PrimitiveType.BOOL;
    }
    Logic(node) {
        this.assertLogical(node.left);
        this.assertLogical(node.right);
        return PrimitiveType.BOOL;
    }
    Compare(node) {
        const leftType = this.visit(node.left);
        const rightType = this.visit(node.right);

        const equality = node.op === "==" || node.op === "!=";

        // boolean comparison
        if (
            leftType === PrimitiveType.BOOL &&
            rightType === PrimitiveType.BOOL &&
            equality
        ) {
            node._compareType = PrimitiveType.BOOL;
            return PrimitiveType.BOOL;
        }

        // pointer comparison
        if (leftType instanceof PointerType && rightType instanceof PointerType) {
            if (!leftType.target.equals(rightType.target))
                node.error(`Cannot compare pointers to different types: '${leftType}' and '${rightType}'`);

            node._compareType = leftType;
            return PrimitiveType.BOOL;
        }

        // arithmetic comparison
        node._compareType = this.getCommonArithmeticType(node.left, node.right);
        return PrimitiveType.BOOL;
    }
    Negate(node) {
        return this.getArithmeticType(node.target);
    }
    Product(node) {
        return this.getCommonArithmeticType(node.left, node.right);
    }
    Sum(node) {
        return this.getCommonArithmeticType(node.left, node.right);
    }
    Cast(cast) {
        return this.assertConvertible(cast.target, this.visit(cast.type));
    }
    Subscript({ arr, index }) {
        const arrType = this.visit(arr);
        const indexType = this.visit(index);

        if (indexType !== PrimitiveType.INT)
            index.error(`Cannot subscript array with non-int type '${indexType}'`);
        
        if (!(arrType instanceof ArrayType))
            arr.error(`Cannot subscript non-array type '${arrType}'`);
            
        return arrType.element;
    }
    Call({ fn, args }) {
        let callee = fn instanceof AST.Reference ? fn._decl : null;
        const caller = this.functions.at(-1);
        if (!this.calls.has(caller))
            this.calls.set(caller, new Set());
        this.calls.get(caller).add(callee);

        const fnType = this.visit(fn);

        if (!(fnType instanceof FunctionType))
            fn.error(`Cannot call non-function type '${fnType}'`);

        if (args.length !== fnType.params.length)
            fn.error(`Wrong number of arguments. Got ${args.length}, but ${fnType.params.length} required`);

        for (let i = 0; i < args.length; i++) {
            const argType = this.visit(args[i]);
            const paramType = fnType.params[i];

            this.assertConvertible(
                args[i], fnType.params[i],
                (src, dst) => `Cannot pass argument of type '${argType}' to parameter of type '${paramType}' (parameter #${i + 1})`
            );
        }

        return fnType.result;
    }
    Assign({ left, right }) {
        this.assertLValue(left, `Cannot assign to a non-lvalue`);
        return this.assertConvertible(right, this.visit(left));
    }
    // statements
    ExpressionStatement(stmt) {
        this.visit(stmt.value);
    }
    Block(block) {
        for (const stmt of block.stmts)
            this.visit(stmt);
    }
    checkLoopControl(stmt, stmtName) {
        const loop = this.loops.at(-1);
        if (!loop || loop instanceof AST.Function)
            stmt.error(`Cannot ${stmtName} outside of a loop`);

        if (loop instanceof AST.Continuing)
            stmt.error(`Cannot ${stmtName} from within a continuing clause`);

        if (stmt.name) {
            if (!(stmt._decl instanceof AST.While))
                stmt.error(`Cannot ${stmtName} non-loop`);

            stmt._loop = stmt._decl;
        } else {
            stmt._loop = loop;
        }
    }
    Break(stmt) {
        this.checkLoopControl(stmt, "break");
    }
    Continue(stmt) {
        this.checkLoopControl(stmt, "continue");
    }
    While(loop) {
        this.loops.push(loop);
        
        this.assertCondition(loop.condition);
        this.visit(loop.body);
        if (loop.continuing) this.visit(loop.continuing);

        this.loops.pop();
    }
    Continuing(continuing) {
        this.loops.push(continuing);
        this.visit(continuing.body);
        this.loops.pop();
    }
    If(branch) {
        this.assertCondition(branch.condition);
        this.visit(branch.ifTrue);
        if (branch.ifFalse) this.visit(branch.ifFalse);
    }
    Return(node) {
        const returnType = this.functions.at(-1)._type.result;

        if (!node.value) {
            if (returnType !== PrimitiveType.VOID)
                node.error(`Must return a value from a function with non-void return type '${returnType}'`);
        } else {
            if (node.value && returnType === PrimitiveType.VOID)
                node.error(`Cannot return a value from a void function`);

            this.assertConvertible(
                node.value, returnType,
                (src, dst) => `Cannot return a value of type '${src}' from a function with return type '${dst}'`
            );
        }
    }
    // declarations
    Param(param) {
        return this.visit(param.type);
    }
    Variable(variable) {
        return this.visit(variable.type);
    }
    getCallable(fn) {
        const found = new Set();
        let toExplore = new Set([fn]);

        while (toExplore.size) {
            const toExploreNext = new Set();

            for (const root of toExplore) {
                const neighbors = this.calls.get(root) ?? new Set();
                for (const neighbor of neighbors) {
                    if (!found.has(neighbor)) {
                        found.add(neighbor);
                        toExploreNext.add(neighbor);
                    }
                }
            }

            toExplore = toExploreNext;
        }

        return found;
    }
    Function(fn) {
        fn._type = new FunctionType(
            this.visit(fn.result),
            fn.params.map(param => this.visit(param))
        );

        this.loops.push(fn);
        this.functions.push(fn);

        this.visit(fn.body);

        this.functions.pop();
        this.loops.pop();

        const callable = this.getCallable(fn);
        fn._recursive = callable.has(fn) || callable.has(null);

        return fn._type;
    }
    root({ decls }) {
        for (const decl of decls)
            this.visit(decl);

        exportGraph(this.calls, "calls.dot", true);
    }
    getArithmeticType(node) {
        const type = this.visit(node);

        if (!type.numeric || !(type instanceof PrimitiveType))
            node.error(`Cannot do arithmetic on non-numeric type '${type}'`);
        
        return type;
    }
    getCommonArithmeticType(a, b) {
        const aType = this.getArithmeticType(a);
        const bType = this.getArithmeticType(b);

        const common = Type.common(aType, bType);

        a._targetType = common;
        b._targetType = common;

        return common;
    }
    assertConvertible(
        node, type,
        message = (src, dst) => `Cannot convert type '${src}' to type '${dst}'`
    ) {
        const nodeType = this.visit(node);
        if (!nodeType.convertibleTo(type))
            node.error(message(nodeType, type));
        node._targetType = type;
        return type;
    }
    assertCondition(condition) {
        this.assertConvertible(
            condition, PrimitiveType.BOOL,
            src => `Cannot use non-boolean type '${src}' as a condition`
        );
    }
    assertLogical(condition) {
        this.assertConvertible(
            condition, PrimitiveType.BOOL,
            src => `Cannot perform logic on non-boolean type '${src}'`
        );
    }
    assertLValue(expr, message) {
        this.visit(expr); // probably produces better error messages if it fails

        if (expr instanceof AST.Dereference)
            return;

        if (expr instanceof AST.Reference) {
            if (expr._decl instanceof AST.Function || expr._decl instanceof AST.Param)
                expr.error(message);
            return;
        }

        if (expr instanceof AST.Subscript) {
            this.assertLValue(expr.arr, message);
            return;
        }

        expr.error(message);
    }
}

export default function typeCheck(root) {
    new TypeChecker().visit(root);
}