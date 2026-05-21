import { AST } from "./ast.mjs";
import { ArrayType, FunctionType, PointerType, PrimitiveType, Type } from "./types.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";


class TypeChecker extends Visitor {
    constructor() {
        super();
        this.returnTypes = [];
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
    Reference(node) {
        return this.visit(node._decl);
    }
    AddressOf(node) {
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

        // pointer comparison
        if (leftType instanceof PointerType && rightType instanceof PointerType) {
            if (!leftType.target.equals(rightType.target))
                node.error(`Cannot compare pointers to different types: '${leftType}' and '${rightType}'`);

            return PrimitiveType.BOOL;
        }

        // arithmetic comparison
        this.getCommonArithmeticType(node.left, node.right);
        return PrimitiveType.BOOL;
    }
    Negate(node) {
        return this.getArithmeticType(node.target);
    }
    Multiply(node) {
        return this.getCommonArithmeticType(node.left, node.right);
    }
    Divide(node) {
        return this.getCommonArithmeticType(node.left, node.right);
    }
    Remainder(node) {
        return this.getCommonArithmeticType(node.left, node.right);
    }
    Sum(node) {
        return this.getCommonArithmeticType(node.left, node.right);
    }
    Cast(cast) {
        const { target, type } = cast;
        const srcType = this.visit(target);
        const dstType = this.visit(type);

        if (!srcType.convertibleTo(dstType))
            cast.error(`Cannot convert type '${srcType}' to '${dstType}'`);

        return dstType;
    }
    Subscript({ arr, index }) {
        const arrType = this.visit(arr);
        const indexType = this.visit(index);

        if (indexType !== PrimitiveType.INT)
            index.error(`Cannot subscript array with non-int type '${indexType}'`);
        
        if (arrType instanceof ArrayType)
            return arrType.element;

        if (arrType instanceof PointerType)
            return arrType.target;

        arr.error(`Cannot subscript non-array/pointer type '${arrType}'`);
    }
    Call({ fn, args }) {
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
    While(loop) {
        this.assertCondition(loop.condition);
        this.visit(loop.body);
        if (loop.continuing) this.visit(loop.continuing);
    }
    If(branch) {
        this.assertCondition(branch.condition);
        this.visit(branch.ifTrue);
        if (branch.ifFalse) this.visit(branch.ifFalse);
    }
    Return(node) {
        const returnType = this.returnTypes.at(-1);

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
    Function(fn) {
        fn._type = new FunctionType(
            this.visit(fn.result),
            fn.params.map(param => this.visit(param))
        );

        this.returnTypes.push(fn._type.result);

        this.visit(fn.body);

        this.returnTypes.pop();

        return fn._type;
    }
    root({ decls }) {
        for (const decl of decls)
            this.visit(decl);
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

        aType._targetType = common;
        bType._targetType = common;

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
}

export default function typeCheck(root) {
    new TypeChecker().visit(root);
}